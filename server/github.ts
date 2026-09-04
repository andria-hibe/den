import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logWarn } from "./log.ts";

const exec = promisify(execFile);

/**
 * True if `repo` is a well-formed GitHub "owner/name" slug. Client-supplied repo
 * values flow into `gh --repo <repo>`; constraining them to GitHub's identifier
 * charset keeps anything odd from reaching the authenticated CLI. (It sits in a
 * value position, so it isn't flag-injectable — this is defence in depth.)
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
  /** Ticket id parsed from the branch (e.g. "fast-5979"), for later linking. */
  ticketHint?: string;
  /** True for your own PRs (authored), false for others' (review-requested). */
  isMine: boolean;
  /** Whether this PR needs *your* action right now. For authored PRs: failing
   * checks or changes requested. For review-requested PRs: you owe a review
   * (first review or a re-review). A review-requested PR's own CI status does
   * NOT count — that's the author's problem, not yours. */
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
 * are failing (1) or still running (8) — exactly the cases we most need to
 * read — so a thrown error must not lose the output. promisified `execFile`
 * attaches the captured streams to the error, so recover `stdout` from there.
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

interface SearchRow {
  number: number;
  title: string;
  url: string;
  repository: { nameWithOwner: string };
  isDraft: boolean;
  updatedAt: string;
}

async function search(filter: string): Promise<SearchRow[]> {
  const out = await gh([
    "search",
    "prs",
    filter,
    "--state=open",
    "--limit=20",
    "--json",
    "number,title,url,repository,isDraft,updatedAt",
  ]);
  return JSON.parse(out) as SearchRow[];
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
 * latest run per check and uncapped, so it matches what GitHub shows you.
 *
 * `skipping`/`cancel` don't count either way (as SKIPPED/CANCELLED didn't
 * before); an unrecognized bucket is ignored rather than invented as a failure.
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

// Branch names look like "jordan-fast-5979-stretch-..." — pull the "fast-NNNN".
// Lowercased, matching LinearIssue.ticketHint, so hints compare directly.
// (Also used by sessions.ts for a session's branch → ticket chip.)
export function parseTicketHint(branch?: string | null): string | undefined {
  const m = branch?.match(/([a-z]+-\d+)/i);
  return m ? m[1].toLowerCase() : undefined;
}

async function enrich(row: SearchRow): Promise<PullRequest> {
  const repo = row.repository.nameWithOwner;
  let branch: string | undefined;
  let checks = summarizeChecks([]);
  let review: ReviewState = "none";
  // Branch/review and CI come from two different gh subcommands (see
  // summarizeChecks on why CI can't come from the rollup), so fetch them
  // together and let each fail on its own — a CI hiccup shouldn't cost us the
  // branch name, and vice versa.
  const [meta, rows] = await Promise.allSettled([
    gh([
      "pr",
      "view",
      String(row.number),
      "--repo",
      repo,
      "--json",
      "headRefName,reviewDecision",
    ]),
    fetchChecks(repo, row.number),
  ]);
  if (meta.status === "fulfilled") {
    try {
      const j = JSON.parse(meta.value) as {
        headRefName?: string;
        reviewDecision?: string | null;
      };
      branch = j.headRefName;
      review = reviewFrom(j.reviewDecision ?? null);
    } catch (err) {
      logWarn(`github.enrich parse pr#${row.number}`, err);
    }
  } else {
    // Enrichment is best-effort; fall back to the search-level data.
    logWarn(`github.enrich pr#${row.number}`, meta.reason);
  }
  if (rows.status === "fulfilled") checks = summarizeChecks(rows.value);
  else logWarn(`github.enrich checks pr#${row.number}`, rows.reason);
  return {
    number: row.number,
    title: row.title,
    url: row.url,
    repo,
    branch,
    isDraft: row.isDraft,
    updatedAt: row.updatedAt,
    checks: checks.state,
    checkCounts: checks.counts,
    review,
    ticketHint: parseTicketHint(branch),
    isMine: false,
    needsAttention: false, // set per-bucket in getMyPullRequests
    reviewRequestedFromMe: false, // set in buildReviewBucket
    reviewedByMe: false,
  };
}

// Bounded-concurrency map so we don't fire 40 `gh pr view` calls at once.
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
 * Does one of *your own* PRs need your action? Only when you have to act: a
 * colleague requested changes, or CI is failing (drafts included — failing
 * checks on your WIP are still yours to fix). A PR's own CI status is your
 * problem here, unlike the review-requested bucket below.
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
 * Does a PR you were *asked to review* need your action? Only while a review
 * request from you is still open (`reviewRequestedFromMe`) — that's GitHub's own
 * record of whether you owe one. Submitting a review clears the request, so the
 * card goes quiet while the PR stays in the bucket; a re-request re-opens it and
 * the "!" comes back. Its own CI is irrelevant to you. Drafts and
 * already-approved PRs never flag: nothing is waiting on you there.
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
 * Build the "review requested" bucket from the PRs of two searches
 * (`--review-requested=@me` and `--reviewed-by=@me`), flag each with whether a
 * review is still requested from you / you have already reviewed it, and sort.
 *
 * Reviewing a PR clears GitHub's review request, which used to make the card
 * vanish mid-flight — so the bucket also carries what you've reviewed, and only
 * drops it when the PR is merged or closed (both searches are `--state=open`).
 * Ones still waiting on you sort first, then most recently updated.
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
  const [authoredRows, requestedRows, reviewedRows] = await Promise.all([
    search("--author=@me"),
    search("--review-requested=@me"),
    search("--reviewed-by=@me"),
  ]);
  const rowKey = (r: SearchRow) =>
    prKey({ repo: r.repository.nameWithOwner, number: r.number });
  const authoredKeys = new Set(authoredRows.map(rowKey));
  const requestedKeys = new Set(requestedRows.map(rowKey));
  const reviewedKeys = new Set(reviewedRows.map(rowKey));
  // Dedupe *before* enriching: a PR you were asked to review and have since
  // reviewed appears in both searches, and enrich() is two gh calls per PR.
  // Your own PRs drop out — they belong in the authored bucket (you can end up
  // in `reviewed-by` on your own PR by commenting on it).
  const reviewRows = new Map<string, SearchRow>();
  for (const r of [...requestedRows, ...reviewedRows]) {
    const key = rowKey(r);
    if (!authoredKeys.has(key)) reviewRows.set(key, r);
  }
  const [authored, reviewPrs] = await Promise.all([
    mapLimit(authoredRows, 6, enrich),
    mapLimit([...reviewRows.values()], 6, enrich),
  ]);
  authored.forEach((p) => {
    p.isMine = true;
    Object.assign(p, authoredAttention(p));
  });
  const reviewRequested = buildReviewBucket(reviewPrs, requestedKeys, reviewedKeys);
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
  // Three independent gh round-trips (PR body/reviews, viewer login, inline
  // review threads) — run them together; the my-PR pane opens on this.
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
// Fetched via GraphQL review *threads* rather than the REST comments endpoint,
// because only the thread carries `isResolved` — which we need so the UI can
// hide comments that have already been resolved.
const REVIEW_THREADS_QUERY =
  `query($owner:String!,$name:String!,$number:Int!){` +
  `repository(owner:$owner,name:$name){pullRequest(number:$number){` +
  `reviewThreads(first:100){nodes{isResolved isOutdated ` +
  `comments(first:50){nodes{author{login} body path line originalLine diffHunk createdAt}}}}}}}`;

interface RawThreadComment {
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
      for (const c of t.comments?.nodes ?? []) {
        if (!c.body) continue;
        notes.push({
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

export async function getPrDiff(repo: string, number: number): Promise<string> {
  return gh(["pr", "diff", String(number), "--repo", repo]);
}

let cachedLogin: string | null = null;
async function viewerLogin(): Promise<string> {
  if (cachedLogin) return cachedLogin;
  try {
    // Only cache a real login — a transient gh failure must not poison the cache
    // with "" for the whole process lifetime (which would mis-attribute "my PRs").
    const login = (await gh(["api", "user", "--jq", ".login"])).trim();
    if (login) cachedLogin = login;
    return login;
  } catch (err) {
    logWarn("github.viewerLogin", err);
    return "";
  }
}


