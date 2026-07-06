import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

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
  repo: string; // nameWithOwner, e.g. "Runn-Fast/runn"
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

function summarizeChecks(rollup: RollupItem[]): {
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

function reviewFrom(decision: string | null): ReviewState {
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
function parseTicketHint(branch?: string): string | undefined {
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
  } catch {
    // Enrichment is best-effort; fall back to the search-level data.
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

export async function getMyPullRequests(): Promise<PrBuckets> {
  const [authoredRows, reviewRows] = await Promise.all([
    search("--author=@me"),
    search("--review-requested=@me"),
  ]);
  const [authored, reviewRequested] = await Promise.all([
    mapLimit(authoredRows, 6, enrich),
    mapLimit(reviewRows, 6, enrich),
  ]);
  authored.forEach((p) => (p.isMine = true));
  return { authored, reviewRequested, fetchedAt: new Date().toISOString() };
}

// --- PR detail, diff, and Claude review -------------------------------------

export interface PrReviewNote {
  author: string;
  state?: string; // reviews only
  body: string;
  at: string;
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
  };
}

export async function getPrDiff(repo: string, number: number): Promise<string> {
  return gh(["pr", "diff", String(number), "--repo", repo]);
}

let cachedLogin: string | null = null;
async function viewerLogin(): Promise<string> {
  if (cachedLogin) return cachedLogin;
  try {
    cachedLogin = (await gh(["api", "user", "--jq", ".login"])).trim();
  } catch {
    cachedLogin = "";
  }
  return cachedLogin;
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
  } catch {
    return [];
  }
}
