import { execFile, spawn } from "node:child_process";
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

interface RollupItem {
  __typename?: string;
  status?: string; // CheckRun: QUEUED|IN_PROGRESS|COMPLETED|PENDING|WAITING
  conclusion?: string; // CheckRun: SUCCESS|FAILURE|SKIPPED|NEUTRAL|...
  state?: string; // StatusContext: SUCCESS|FAILURE|ERROR|PENDING|EXPECTED
}

const FAIL_CONCLUSIONS = new Set([
  "FAILURE",
  "TIMED_OUT",
  "STARTUP_FAILURE",
  "ACTION_REQUIRED",
]);
const NEUTRAL_CONCLUSIONS = new Set(["SKIPPED", "NEUTRAL", "CANCELLED"]);

export function summarizeChecks(rollup: RollupItem[]): {
  state: CheckState;
  counts: PullRequest["checkCounts"];
} {
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const it of rollup) {
    if (it.state !== undefined) {
      // StatusContext
      if (it.state === "FAILURE" || it.state === "ERROR") failed++;
      else if (it.state === "SUCCESS") passed++;
      else if (it.state === "PENDING" || it.state === "EXPECTED") pending++;
      continue;
    }
    // CheckRun
    if (it.status !== "COMPLETED") {
      pending++;
    } else if (it.conclusion && FAIL_CONCLUSIONS.has(it.conclusion)) {
      failed++;
    } else if (it.conclusion && NEUTRAL_CONCLUSIONS.has(it.conclusion)) {
      // ignore for pass/fail
    } else if (it.conclusion === "SUCCESS") {
      passed++;
    }
  }
  const total = passed + failed + pending;
  const state: CheckState =
    total === 0 ? "none" : failed > 0 ? "failing" : pending > 0 ? "pending" : "passing";
  return { state, counts: { passed, failed, pending, total } };
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
export function parseTicketHint(branch?: string): string | undefined {
  if (!branch) return undefined;
  const m = branch.match(/([a-z]+-\d+)/i);
  return m?.[1];
}

async function enrich(row: SearchRow): Promise<PullRequest> {
  const repo = row.repository.nameWithOwner;
  let branch: string | undefined;
  let checks = summarizeChecks([]);
  let review: ReviewState = "none";
  try {
    const out = await gh([
      "pr",
      "view",
      String(row.number),
      "--repo",
      repo,
      "--json",
      "headRefName,reviewDecision,statusCheckRollup",
    ]);
    const j = JSON.parse(out) as {
      headRefName?: string;
      reviewDecision?: string | null;
      statusCheckRollup?: RollupItem[];
    };
    branch = j.headRefName;
    checks = summarizeChecks(j.statusCheckRollup ?? []);
    review = reviewFrom(j.reviewDecision ?? null);
  } catch (err) {
    // Enrichment is best-effort; fall back to the search-level data.
    logWarn(`github.enrich pr#${row.number}`, err);
  }
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
 * Does a PR you were *asked to review* need your action? Yes whenever you owe a
 * review — a first review or a re-review (GitHub re-adds you either way). Its own
 * CI is irrelevant to you. But once the PR is already approved you no longer owe
 * anything, and drafts aren't ready for review — neither flags.
 */
export function reviewAttention(p: Pick<PullRequest, "isDraft" | "review">): {
  needsAttention: boolean;
  attentionReason?: string;
} {
  const needs = !p.isDraft && p.review !== "approved";
  return needs
    ? { needsAttention: true, attentionReason: "your review is requested" }
    : { needsAttention: false };
}

export async function getMyPullRequests(): Promise<PrBuckets> {
  const [authoredRows, reviewRows] = await Promise.all([
    search("--author=@me"),
    search("--review-requested=@me"),
  ]);
  const [authored, reviewRequested] = await Promise.all([
    mapLimit(authoredRows, 6, enrich),
    mapLimit(reviewRows, 6, enrich),
  ]);
  authored.forEach((p) => {
    p.isMine = true;
    Object.assign(p, authoredAttention(p));
  });
  reviewRequested.forEach((p) => {
    Object.assign(p, reviewAttention(p));
  });
  return { authored, reviewRequested, fetchedAt: new Date().toISOString() };
}

// --- PR detail, diff, and Claude review -------------------------------------

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
  const out = await gh([
    "pr", "view", String(number), "--repo", repo,
    "--json", "number,title,url,body,headRefName,author,reviews,comments",
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
  const me = await viewerLogin();
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
    reviewComments: await getReviewComments(repo, number),
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

const CLAUDE_BIN = process.env.MC_CLAUDE_BIN ?? "claude";

/** Run `claude -p <prompt>` with `input` on stdin; resolve its stdout. */
function claudePrint(prompt: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(CLAUDE_BIN, ["-p", prompt], { timeout: 180_000 });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(out.trim())
        : reject(new Error(err.trim() || `claude exited ${code}`)),
    );
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** Ask Claude (headless) for a written review of a PR's diff. */
export async function reviewPr(repo: string, number: number): Promise<string> {
  const diff = (await getPrDiff(repo, number)).slice(0, 200_000);
  const prompt =
    "You are reviewing a GitHub pull request. The unified diff follows on " +
    "stdin. Give a concise, skimmable code review in markdown with sections: " +
    "**Summary**, **Potential bugs**, **Risky changes**, **Suggestions**. Be " +
    "specific and reference file names. If it looks solid, say so briefly.";
  return claudePrint(prompt, diff);
}

export interface FileSummary {
  file: string;
  summary: string;
}

/** Per-file one-line summaries of a PR's diff, for a scannable side column. */
export async function summarizePrDiff(
  repo: string,
  number: number,
): Promise<FileSummary[]> {
  const diff = (await getPrDiff(repo, number)).slice(0, 200_000);
  const prompt =
    "Summarize this PR's unified diff (on stdin), one entry per changed file. " +
    'Return ONLY a JSON array, no prose or code fences: [{"file": "<the path ' +
    'exactly as it appears after "b/" in the file\'s "diff --git a/… b/…" ' +
    'line>", "summary": "<one concise sentence: what changed in this file and ' +
    'why>"}].';
  const raw = await claudePrint(prompt, diff);
  const m = raw.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const parsed = JSON.parse(m[0]) as FileSummary[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    logWarn("github.summarizePrDiff parse", err);
    return [];
  }
}
