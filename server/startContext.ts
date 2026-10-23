// What already exists for a branch when den opens a workspace on it (#35):
// commits, PRs for the ticket and its sub-tickets, and handover or plan
// files other sessions left. Sessions used to start from "Not started yet"
// and re-plan work that was half done.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SESSION_NOTES_HEADING } from "../shared/handover.ts";
import type { PullRequest } from "./github.ts";
import { listWorktrees } from "./git.ts";

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await execFileP("git", ["-C", cwd, ...args], { timeout: 15000 })).stdout.trim();
  } catch {
    return null;
  }
}

const hasRef = async (cwd: string, ref: string) =>
  (await git(cwd, ["rev-parse", "--verify", "--quiet", ref])) !== null;

export interface StartInput {
  repo: string;
  cwd: string;
  branch: string;
  base: string | null;
  ticket?: string | null;
  subIssues: { identifier: string; branchName: string }[];
  prs: PullRequest[];
}

async function branchLines(i: StartInput): Promise<string[]> {
  if (!i.base) return [];
  const baseRef = (await hasRef(i.cwd, `refs/remotes/origin/${i.base}`)) ? `origin/${i.base}` : i.base;
  const ahead = Number(await git(i.cwd, ["rev-list", "--count", `${baseRef}..HEAD`])) || 0;
  if (!ahead) return [];
  const latest = await git(i.cwd, ["log", "-1", "--format=%s"]);
  let pushed = "not pushed";
  if (await hasRef(i.cwd, `refs/remotes/origin/${i.branch}`)) {
    const counts = await git(i.cwd, ["rev-list", "--left-right", "--count", `HEAD...origin/${i.branch}`]);
    const [mine, theirs] = (counts ?? "0 0").split(/\s+/).map(Number);
    pushed = mine || theirs ? `origin is ${theirs} ahead and ${mine} behind it` : "pushed";
  }
  return [`Branch ${i.branch} already has ${ahead} commits that ${i.base} doesn't (latest: "${latest}"), ${pushed}.`];
}

function prLines(i: StartInput): string[] {
  const ids = [i.ticket, ...i.subIssues.map((s) => s.identifier)].filter(Boolean).map((t) => t!.toLowerCase());
  const branches = new Set([i.branch, ...i.subIssues.map((s) => s.branchName)]);
  return i.prs
    .filter((p) => (p.branch && branches.has(p.branch)) || (p.ticketHint && ids.includes(p.ticketHint)))
    .map(
      (p) =>
        `PR #${p.number} (${p.branch ?? "?"} -> ${p.baseBranch ?? "?"}): ` +
        `${p.isDraft ? "draft" : "ready"}, CI ${p.checks}, ${p.url}`,
    );
}

/** Handover-like files at the root of the repo's other worktrees, and Claude
 * Code plan files, that name the ticket. */
function fileLines(i: StartInput): string[] {
  const id = i.ticket?.toLowerCase();
  if (!id) return [];
  const found: string[] = [];
  let trees: string[] = [];
  try {
    trees = listWorktrees(i.repo).map((w) => w.path).filter((p) => p !== i.cwd);
  } catch {
    // not a repo
  }
  for (const dir of trees) {
    try {
      for (const f of readdirSync(dir)) {
        if (/handover/i.test(f) && f.toLowerCase().includes(id) && f.endsWith(".md")) found.push(join(dir, f));
      }
    } catch {
      // worktree folder gone
    }
  }
  const plans = join(homedir(), ".claude", "plans");
  try {
    const named = readdirSync(plans)
      .filter((f) => f.endsWith(".md"))
      .map((f) => join(plans, f))
      .filter((f) => readFileSync(f, "utf8").toLowerCase().includes(id))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
      .slice(0, 3);
    found.push(...named);
  } catch {
    // no plans folder
  }
  return found.map((f) => `Notes another session left: ${f}`);
}

export async function foundAtStart(i: StartInput): Promise<string[]> {
  return [...(await branchLines(i)), ...prLines(i), ...fileLines(i)];
}

/** The seed with what den found under its session notes, in place of the
 * empty template's "Nothing yet.". A seed without that line is unchanged. */
export function withFoundAtStart(seed: string, lines: string[]): string {
  const empty = `## ${SESSION_NOTES_HEADING}\n\nNothing yet.\n`;
  if (!lines.length || !seed.includes(empty)) return seed;
  return seed.replace(
    empty,
    `## ${SESSION_NOTES_HEADING}\n\nFound by den when this workspace opened; check it before relying on it:\n` +
      lines.map((l) => `- ${l}`).join("\n") +
      "\n",
  );
}
