// Stacked branches (#33): how far each workspace's branch is behind the
// branch it sits on and behind its own origin copy, and a message to the
// session when a stacked parent moves, so sessions stop telling each other
// "your base moved" by hand.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isValidBranch } from "../shared/branch.ts";
import type { PullRequest } from "./github.ts";
import { logWarn } from "./log.ts";

const execFileP = promisify(execFile);

async function git(cwd: string, args: string[], timeout = 15000): Promise<string> {
  const { stdout } = await execFileP("git", ["-C", cwd, ...args], { timeout });
  return stdout.trim();
}

async function tryGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    return await git(cwd, args);
  } catch {
    return null;
  }
}

export interface StackStatus {
  /** The branch this one sits on: its PR's base, else the repo's base. */
  parent: string;
  /** The parent is another work branch, not the repo's base branch. */
  stacked: boolean;
  /** Commits on the parent this branch doesn't have. */
  behindParent: number;
  /** Commits on origin/<branch> this checkout doesn't have (pushed from
   * elsewhere). */
  behindOrigin: number;
}

/** What a session needs for a refresh. `base` is the repo's base branch. */
export interface StackTarget {
  id: string;
  groupId: string;
  cwd: string;
  base: string | null;
}

const statuses = new Map<string, StackStatus>();
const parentTips = new Map<string, string>();
let prByBranch = new Map<string, PullRequest>();

export function stackStatus(sessionId: string): StackStatus | null {
  return statuses.get(sessionId) ?? null;
}

/** The latest PR list, for each branch's PR base. */
export function notePrs(prs: PullRequest[]): void {
  prByBranch = new Map(prs.filter((p) => p.branch).map((p) => [p.branch!, p]));
}

/** The message for a session whose stacked parent moved, or null when there's
 * nothing to say. */
export function parentMovedMessage(
  before: string | undefined,
  tip: string,
  status: StackStatus,
): string | null {
  if (!before || before === tip || !status.stacked || status.behindParent === 0) return null;
  const n = status.behindParent;
  return (
    `The branch this one is stacked on, ${status.parent}, moved (now ${tip.slice(0, 7)}). ` +
    `This branch is ${n} commit${n === 1 ? "" : "s"} behind it; merge or rebase when it suits the work.`
  );
}

async function refreshOne(t: StackTarget, tell: (groupId: string, msg: string) => void) {
  const branch = await tryGit(t.cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch || branch === "HEAD") {
    statuses.delete(t.id);
    return;
  }
  const parent = prByBranch.get(branch)?.baseBranch ?? t.base;
  if (!parent || parent === branch || !isValidBranch(parent)) {
    statuses.delete(t.id);
    return;
  }
  const hasRef = async (ref: string) => (await tryGit(t.cwd, ["rev-parse", "--verify", "--quiet", ref])) !== null;
  // The pushed parent is what its PR and the other sessions see.
  const parentRef = (await hasRef(`refs/remotes/origin/${parent}`))
    ? `origin/${parent}`
    : (await hasRef(`refs/heads/${parent}`))
      ? parent
      : null;
  if (!parentRef) {
    statuses.delete(t.id);
    return;
  }
  const count = async (range: string) => Number(await tryGit(t.cwd, ["rev-list", "--count", range])) || 0;
  const status: StackStatus = {
    parent,
    stacked: parent !== t.base,
    behindParent: await count(`HEAD..${parentRef}`),
    behindOrigin: (await hasRef(`refs/remotes/origin/${branch}`)) ? await count(`HEAD..origin/${branch}`) : 0,
  };
  const tip = (await tryGit(t.cwd, ["rev-parse", parentRef])) ?? "";
  const message = parentMovedMessage(parentTips.get(t.id), tip, status);
  if (message) tell(t.groupId, message);
  parentTips.set(t.id, tip);
  statuses.set(t.id, status);
}

/** Fetch each repo once, then refresh every target. */
export async function refreshStacks(
  targets: StackTarget[],
  tell: (groupId: string, msg: string) => void,
): Promise<void> {
  const repos = new Map<string, string>();
  for (const t of targets) {
    const common = await tryGit(t.cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (common && !repos.has(common)) repos.set(common, t.cwd);
  }
  for (const cwd of repos.values()) {
    try {
      await git(cwd, ["fetch", "origin", "--quiet"], 60000);
    } catch (err) {
      logWarn("stack.fetch", err); // offline: compare against what's local
    }
  }
  const live = new Set(targets.map((t) => t.id));
  for (const id of [...statuses.keys(), ...parentTips.keys()]) {
    if (!live.has(id)) {
      statuses.delete(id);
      parentTips.delete(id);
    }
  }
  for (const t of targets) await refreshOne(t, tell);
}
