import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logWarn } from "./log.ts";

const exec = promisify(execFile);

/**
 * True if `repo` is a well-formed GitHub "owner/name" slug. Client-supplied
 * values reach `gh --repo`; that's a value position, so this is defence in
 * depth rather than a flag-injection guard.
 */
export function isValidRepo(repo: string): boolean {
  // First char isn't a dash, so the whole value can never be read as a flag.
  return /^[A-Za-z0-9._][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+$/.test(repo);
}

// --- Types exposed to the web app -------------------------------------------

export type CheckState = "passing" | "failing" | "pending" | "none";
export type ReviewState =
  | "approved"
  | "changes_requested"
  | "review_required"
  | "none";

export interface PullRequest {
  number: number;
  title: string;
  url: string;
  repo: string; // nameWithOwner, e.g. "owner/repo"
  branch?: string; // headRefName
  isDraft: boolean;
  updatedAt: string;
  checks: CheckState;
  checkCounts: { passed: number; failed: number; pending: number; total: number };
  review: ReviewState;
  /** Ticket id parsed from the branch (e.g. "fast-5979"). */
  ticketHint?: string;
  /** True for your own PRs (authored), false for others' (review-requested). */
  isMine: boolean;
  /** Whether this PR needs *your* action right now. For authored PRs: failing
   * checks or changes requested. For review-requested PRs: you owe a review
   * (first review or a re-review). A review-requested PR's own CI does not
   * count. */
  needsAttention: boolean;
  /** Short human reason for `needsAttention`, for a card tooltip. */
  attentionReason?: string;
  /** Review bucket only: GitHub still has an open review request from you, so a
   * review is outstanding. Cleared the moment you submit one, and set again if
   * the author asks for a re-review. */
  reviewRequestedFromMe: boolean;
  /** Review bucket only: you have already submitted a review on this PR. Such a
   * PR stays in the bucket (until it's merged or closed) but doesn't nag. */
  reviewedByMe: boolean;
}

export interface PrBuckets {
  authored: PullRequest[];
  reviewRequested: PullRequest[];
  fetchedAt: string;
}

// --- gh helpers -------------------------------------------------------------

async function gh(args: string[]): Promise<string> {
  const { stdout } = await exec("gh", args, { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

/**
 * Like `gh()`, but for subcommands that use the **exit code as a status** and
 * still print their `--json` payload. `gh pr checks` exits non-zero when checks
 * are failing (1) or still running (8), exactly the cases we need to read.
 * Promisified `execFile` attaches the captured streams to the error, so
 * `stdout` is recovered from there.
 */
async function ghAllowFail(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await exec("gh", args, { maxBuffer: 20 * 1024 * 1024 });
    return { stdout, stderr };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    if (typeof e.stdout !== "string") throw err; // a real spawn failure, not a status
    return { stdout: e.stdout, stderr: e.stderr ?? "" };
  }
}

const SEARCH_LIMIT = 20;
const SEARCH_ATTEMPTS = 3;
const SEARCHES = {
  authored: "is:pr is:open author:@me",
  requested: "is:pr is:open review-requested:@me",
  reviewed: "is:pr is:open reviewed-by:@me",
} as const;
type SearchName = keyof typeof SEARCHES;

// One GraphQL request instead of three `gh search prs` calls plus a `gh pr view`
// per PR, to stay under GitHub's secondary rate limit.
const PR_SEARCH_QUERY =
  `query{viewer{login} ` +
  Object.entries(SEARCHES)
    .map(
      ([alias, q]) =>
        `${alias}:search(type:ISSUE,first:${SEARCH_LIMIT},query:"${q}"){issueCount nodes{` +
        `... on PullRequest{number title url isDraft updatedAt headRefName reviewDecision ` +
        `author{login} repository{nameWithOwner}}}}`,
    )
    .join(" ") +
  `}`;

export interface SearchNode {
  number: number;
  title: string;
  url: string;
  isDraft: boolean;
  updatedAt: string;
  headRefName?: string | null;
  reviewDecision?: string | null;
  author?: { login: string } | null;
  repository: { nameWithOwner: string };
}

type SearchHits = Record<SearchName, SearchNode[]>;

const nodeKey = (n: SearchNode) => prKey({ repo: n.repository.nameWithOwner, number: n.number });

/**
 * Runs the searches, retrying while any comes back short. GitHub's search
 * intermittently returns its `issueCount` with fewer nodes than that, often
 * none (seen 2026-10-23 on the same query seconds apart), which emptied the
 * review bucket. Nodes are unioned across attempts.
 */
async function searchPrs(): Promise<{ viewer: string; hits: SearchHits }> {
  const names = Object.keys(SEARCHES) as SearchName[];
  const found = Object.fromEntries(names.map((n) => [n, new Map<string, SearchNode>()])) as Record<
    SearchName,
    Map<string, SearchNode>
  >;
  let viewer: string;
  for (let attempt = 1; ; attempt++) {
    const out = await gh(["api", "graphql", "-f", `query=${PR_SEARCH_QUERY}`]);
    const data = (JSON.parse(out) as {
      data: { viewer: { login: string } } & Record<
        SearchName,
        { issueCount: number; nodes: (SearchNode | null)[] }
      >;
    }).data;
    viewer = data.viewer.login;
    const short = names.filter((name) => {
      // A non-PR hit would come back as {}, hence the number check.
      for (const n of data[name].nodes) if (n?.number) found[name].set(nodeKey(n), n);
      return found[name].size < Math.min(data[name].issueCount, SEARCH_LIMIT);
    });
    if (!short.length) break;
    if (attempt === SEARCH_ATTEMPTS) {
      logWarn("github.search", `still short after ${attempt} tries: ${short.join(", ")}`);
      break;
    }
  }
  const hits = Object.fromEntries(names.map((n) => [n, [...found[n].values()]])) as SearchHits;
  return { viewer, hits };
}

/**
 * Files each PR by its author, not by which search found it: `reviewed-by`
 * matches your own PRs once you comment on them, so when the `author` search
 * comes back short your PRs would otherwise land in the review bucket.
 */
export function splitByAuthor(
  viewer: string,
  hits: SearchHits,
): { authored: SearchNode[]; review: SearchNode[] } {
  const mine = (n: SearchNode) => n.author?.login.toLowerCase() === viewer.toLowerCase();
  const authored = new Map<string, SearchNode>();
  const review = new Map<string, SearchNode>();
  for (const n of hits.authored) if (mine(n)) authored.set(nodeKey(n), n);
  for (const n of [...hits.requested, ...hits.reviewed]) {
    (mine(n) ? authored : review).set(nodeKey(n), n);
  }
  return { authored: [...authored.values()], review: [...review.values()] };
}

/** One row of `gh pr checks --json bucket` (one check, latest run only). */
export interface CheckRow {
  /** gh's own rollup of a check's state: pass|fail|pending|skipping|cancel. */
  bucket?: string;
}

/**
 * Summarize a PR's CI from `gh pr checks` buckets.
 *
 * Sourced from `gh pr checks` rather than `gh pr view --json statusCheckRollup`
 * on purpose: the rollup lists **every** check run including superseded ones, so
 * a re-run that has since gone green still carries its old FAILURE row and the
 * PR reads as failing forever (seen on Runn-Fast/runn#20662: 116 rollup rows vs
 * 99 real checks, one stale "Validate PR title" failure). It is also capped at
 * ~100 contexts, which runn PRs sit right at. `gh pr checks` is deduped to the
 * latest run per check and uncapped.
 *
 * `skipping`/`cancel` don't count either way; an unrecognized bucket is
 * ignored rather than read as a failure.
 */
export function summarizeChecks(rows: CheckRow[]): {
  state: CheckState;
  counts: PullRequest["checkCounts"];
} {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.bucket === "pass") passed++;
    else if (r.bucket === "fail") failed++;
    else if (r.bucket === "pending") pending++;
  }
  const total = passed + failed + pending;
  const state: CheckState =
    total === 0 ? "none" : failed > 0 ? "failing" : pending > 0 ? "pending" : "passing";
  return { state, counts: { passed, failed, pending, total } };
}

/**
 * `gh pr checks <n> --json bucket` for one PR, tolerant of its status exit
 * codes. A PR with no CI at all exits 1 with an empty payload ("no checks
 * reported on the 'x' branch") — that's a legitimate `none`, not an error.
 */
async function fetchChecks(repo: string, number: number): Promise<CheckRow[]> {
  const { stdout, stderr } = await ghAllowFail([
    "pr", "checks", String(number), "--repo", repo, "--json", "bucket",
  ]);
  if (!stdout.trim()) {
    // Expected for a branch with no checks; anything else is worth surfacing.
    if (!/no checks reported/i.test(stderr)) {
      logWarn(`github.checks pr#${number} empty payload`, stderr.trim());
    }
    return [];
  }
  const parsed = JSON.parse(stdout) as CheckRow[];
  return Array.isArray(parsed) ? parsed : [];
}

export function reviewFrom(decision: string | null): ReviewState {
  switch (decision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return "none";
  }
}

// Branch names look like "jordan-fast-5979-stretch-...". Lowercased to match
// LinearIssue.ticketHint, so hints compare directly.
export function parseTicketHint(branch?: string | null): string | undefined {
  const m = branch?.match(/([a-z]+-\d+)/i);
  return m ? m[1].toLowerCase() : undefined;
}

async function toPullRequest(n: SearchNode): Promise<PullRequest> {
  const repo = n.repository.nameWithOwner;
  let checks = summarizeChecks([]);
  // See summarizeChecks for why CI can't come from the search's rollup.
  try {
    checks = summarizeChecks(await fetchChecks(repo, n.number));
  } catch (err) {
    logWarn(`github.checks pr#${n.number}`, err);
  }
  const branch = n.headRefName ?? undefined;
  return {
    number: n.number,
    title: n.title,
    url: n.url,
    repo,
    branch,
    isDraft: n.isDraft,
    updatedAt: n.updatedAt,
    checks: checks.state,
    checkCounts: checks.counts,
    review: reviewFrom(n.reviewDecision ?? null),
    ticketHint: parseTicketHint(branch),
    isMine: false,
    needsAttention: false, // set per-bucket in getMyPullRequests
    reviewRequestedFromMe: false, // set in buildReviewBucket
    reviewedByMe: false,
  };
}

// Bounded-concurrency map so we don't fire 40 `gh pr checks` calls at once.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Does one of your own PRs need your action? When a colleague requested
 * changes, or CI is failing (drafts included: failing checks on your WIP are
 * still yours to fix).
 */
export function authoredAttention(p: Pick<PullRequest, "review" | "checks">): {
  needsAttention: boolean;
  attentionReason?: string;
} {
  const reasons: string[] = [];
  if (p.review === "changes_requested") reasons.push("changes requested");
  if (p.checks === "failing") reasons.push("checks failing");
  return reasons.length
    ? { needsAttention: true, attentionReason: reasons.join(" · ") }
    : { needsAttention: false };
}

/**
 * Does a PR you were asked to review need your action? Only while a review
 * request from you is open (`reviewRequestedFromMe`), GitHub's own record of
 * whether you owe one: submitting a review clears it, a re-request reopens it.
 * Its CI is irrelevant to you. Drafts and already-approved PRs never flag.
 */
export function reviewAttention(
  p: Pick<PullRequest, "isDraft" | "review" | "reviewRequestedFromMe" | "reviewedByMe">,
): { needsAttention: boolean; attentionReason?: string } {
  if (p.isDraft || !p.reviewRequestedFromMe || p.review === "approved") {
    return { needsAttention: false };
  }
  return {
    needsAttention: true,
    attentionReason: p.reviewedByMe
      ? "a re-review is requested"
      : "your review is requested",
  };
}

/** "owner/repo#123" — how a PR is deduped across the three searches. */
export function prKey(p: { repo: string; number: number }): string {
  return `${p.repo}#${p.number}`;
}

/**
 * The "review requested" bucket, from the `--review-requested=@me` and
 * `--reviewed-by=@me` searches. Reviewing a PR clears GitHub's review
 * request, so the reviewed-by search keeps the card until the PR is merged or
 * closed (both searches are `--state=open`). Ones still waiting on you sort
 * first, then most recently updated.
 */
export function buildReviewBucket(
  prs: PullRequest[],
  requestedKeys: Set<string>,
  reviewedKeys: Set<string>,
): PullRequest[] {
  const flagged = prs.map((p) => {
    const key = prKey(p);
    const withFlags: PullRequest = {
      ...p,
      reviewRequestedFromMe: requestedKeys.has(key),
      reviewedByMe: reviewedKeys.has(key),
    };
    return { ...withFlags, ...reviewAttention(withFlags) };
  });
  return flagged.sort(
    (a, b) =>
      Number(b.needsAttention) - Number(a.needsAttention) ||
      b.updatedAt.localeCompare(a.updatedAt),
  );
}

export async function getMyPullRequests(): Promise<PrBuckets> {
  const { viewer, hits } = await searchPrs();
  const { authored: authoredNodes, review: reviewNodes } = splitByAuthor(viewer, hits);
  const [authored, reviewPrs] = await Promise.all([
    mapLimit(authoredNodes, 6, toPullRequest),
    mapLimit(reviewNodes, 6, toPullRequest),
  ]);
  authored.forEach((p) => {
    p.isMine = true;
    Object.assign(p, authoredAttention(p));
  });
  const reviewRequested = buildReviewBucket(
    reviewPrs,
    new Set(hits.requested.map(nodeKey)),
    new Set(hits.reviewed.map(nodeKey)),
  );
  return { authored, reviewRequested, fetchedAt: new Date().toISOString() };
}

// --- PR detail and diff ------------------------------------------------------

export interface PrReviewNote {
  author: string;
  state?: string; // reviews only
  body: string;
  at: string;
  path?: string; // inline review comments only
  line?: number; // inline review comments only
  diffHunk?: string; // inline review comments only
  /** Inline comments only: the review thread was marked resolved / is outdated. */
  resolved?: boolean;
  outdated?: boolean;
  /** Inline comments only: the thread's GraphQL node id (to resolve it), the
   * REST id of the thread's first comment (replies attach to that one), and
   * whether this note is that first comment. */
  threadId?: string;
  replyTo?: number;
  first?: boolean;
}
export interface PrDetail {
  number: number;
  repo: string;
  title: string;
  url: string;
  branch: string;
  body: string;
  isMine: boolean;
  reviews: PrReviewNote[];
  comments: PrReviewNote[];
  reviewComments: PrReviewNote[]; // inline, line-level comments on the diff
}

export async function getPrDetail(repo: string, number: number): Promise<PrDetail> {
  // Run together: the my-PR pane opens on this.
  const [out, me, reviewComments] = await Promise.all([
    gh([
      "pr", "view", String(number), "--repo", repo,
      "--json", "number,title,url,body,headRefName,author,reviews,comments",
    ]),
    viewerLogin(),
    getReviewComments(repo, number),
  ]);
  const j = JSON.parse(out) as {
    number: number;
    title: string;
    url: string;
    body: string;
    headRefName: string;
    author: { login: string };
    reviews: { author?: { login: string }; state: string; body: string; submittedAt: string }[];
    comments: { author?: { login: string }; body: string; createdAt: string }[];
  };
  return {
    number: j.number,
    repo,
    title: j.title,
    url: j.url,
    branch: j.headRefName,
    body: j.body ?? "",
    isMine: j.author?.login === me,
    reviews: (j.reviews ?? [])
      .filter((r) => r.body || r.state)
      .map((r) => ({
        author: r.author?.login ?? "?",
        state: r.state,
        body: r.body ?? "",
        at: r.submittedAt,
      })),
    comments: (j.comments ?? []).map((c) => ({
      author: c.author?.login ?? "?",
      body: c.body ?? "",
      at: c.createdAt,
    })),
    reviewComments,
  };
}

// Inline, line-level review comments on the diff (not returned by pr view).
// Fetched via GraphQL review threads rather than the REST comments endpoint,
// because only the thread carries `isResolved`.
const REVIEW_THREADS_QUERY =
  `query($owner:String!,$name:String!,$number:Int!){` +
  `repository(owner:$owner,name:$name){pullRequest(number:$number){` +
  `reviewThreads(first:100){nodes{id isResolved isOutdated ` +
  `comments(first:50){nodes{databaseId author{login} body path line originalLine diffHunk createdAt}}}}}}}`;

interface RawThreadComment {
  databaseId?: number | null;
  author?: { login: string } | null;
  body: string;
  path?: string | null;
  line?: number | null;
  originalLine?: number | null;
  diffHunk?: string | null;
  createdAt: string;
}

async function getReviewComments(
  repo: string,
  number: number,
): Promise<PrReviewNote[]> {
  const [owner, name] = repo.split("/");
  if (!owner || !name) return [];
  try {
    const out = await gh([
      "api", "graphql",
      "-f", `query=${REVIEW_THREADS_QUERY}`,
      "-F", `owner=${owner}`,
      "-F", `name=${name}`,
      "-F", `number=${number}`,
    ]);
    const j = JSON.parse(out) as {
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: {
              nodes?: {
                id?: string;
                isResolved?: boolean;
                isOutdated?: boolean;
                comments?: { nodes?: RawThreadComment[] };
              }[];
            };
          };
        };
      };
    };
    const threads = j.data?.repository?.pullRequest?.reviewThreads?.nodes ?? [];
    const notes: PrReviewNote[] = [];
    for (const t of threads) {
      const root = t.comments?.nodes?.[0]?.databaseId ?? undefined;
      for (const [i, c] of (t.comments?.nodes ?? []).entries()) {
        if (!c.body) continue;
        notes.push({
          threadId: t.id ?? undefined,
          replyTo: root,
          first: i === 0,
          author: c.author?.login ?? "?",
          body: c.body,
          path: c.path ?? undefined,
          line: c.line ?? c.originalLine ?? undefined,
          diffHunk: c.diffHunk ?? undefined,
          at: c.createdAt,
          resolved: !!t.isResolved,
          outdated: !!t.isOutdated,
        });
      }
    }
    return notes;
  } catch (err) {
    logWarn(`github.reviewComments pr#${number}`, err);
    return [];
  }
}

// --- Posting to GitHub (#16) -----------------------------------------------
// Everything below writes to GitHub as the developer. It is only reached from
// den's own routes after the developer has seen exactly what goes and clicked
// to confirm; a review *session* can never call it (its permissions deny every
// writing gh subcommand, see buildReviewPermissions).

export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface ReviewComment {
  path: string;
  line: number;
  body: string;
}

/** The REST body for "create a review". Inline comments sit on the new side
 * of the diff. */
export function reviewRequestBody(event: ReviewEvent, body: string, comments: ReviewComment[]) {
  return {
    event,
    body,
    comments: comments.map((c) => ({ path: c.path, line: c.line, side: "RIGHT", body: c.body })),
  };
}

/** `gh api` with a JSON request body on stdin. */
function ghWithInput(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("gh", args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stderr }));
      else resolve(stdout);
    });
    child.stdin?.end(input);
  });
}

/** Submit a review on a PR. Returns the review's URL. */
export async function submitReview(
  repo: string,
  number: number,
  event: ReviewEvent,
  body: string,
  comments: ReviewComment[],
): Promise<string> {
  const out = await ghWithInput(
    ["api", "-X", "POST", `repos/${repo}/pulls/${number}/reviews`, "--input", "-"],
    JSON.stringify(reviewRequestBody(event, body, comments)),
  );
  return (JSON.parse(out) as { html_url?: string }).html_url ?? "";
}

/** Reply to an inline review thread, by the REST id of its first comment. */
export async function replyToThread(
  repo: string,
  number: number,
  commentId: number,
  body: string,
): Promise<void> {
  await ghWithInput(
    ["api", "-X", "POST", `repos/${repo}/pulls/${number}/comments/${commentId}/replies`, "--input", "-"],
    JSON.stringify({ body }),
  );
}

/** Mark an inline review thread resolved, by its GraphQL node id. */
export async function resolveThread(threadId: string): Promise<void> {
  await gh([
    "api", "graphql",
    "-f", "query=mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}",
    "-f", `id=${threadId}`,
  ]);
}

/** A GraphQL node id as GitHub issues them (e.g. PRRT_kwDOABC123). */
export function isValidNodeId(id: string): boolean {
  return /^[A-Za-z0-9_=-]{4,128}$/.test(id);
}

export async function getPrDiff(repo: string, number: number): Promise<string> {
  return gh(["pr", "diff", String(number), "--repo", repo]);
}

let cachedLogin: string | null = null;
async function viewerLogin(): Promise<string> {
  if (cachedLogin) return cachedLogin;
  try {
    // Only cache a real login: a transient gh failure must not cache "" for
    // the whole process lifetime.
    const login = (await gh(["api", "user", "--jq", ".login"])).trim();
    if (login) cachedLogin = login;
    return login;
  } catch (err) {
    logWarn("github.viewerLogin", err);
    return "";
  }
}


