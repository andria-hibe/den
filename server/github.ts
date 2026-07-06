import { execFile } from "node:child_process";
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
  return { authored, reviewRequested, fetchedAt: new Date().toISOString() };
}
