import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, sep } from "node:path";
import { logWarn } from "./log.ts";
import { isValidBranch } from "../shared/branch.ts";

// The rule lives in shared/ so the New Session dialog can apply it too.
export { isValidBranch } from "../shared/branch.ts";

function assertValidBranch(branch: string): void {
  if (!isValidBranch(branch)) throw new Error("invalid_branch");
}

function git(cwd: string, args: string[], timeout = 20000): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** One checkout of a repo: the primary working copy or an added worktree.
 * The UI calls these "workspaces". */
export interface Worktree {
  path: string;
  /** Branch name, or null when the worktree is on a detached HEAD. */
  branch: string | null;
  /** Short HEAD sha, "" for a bare repo. */
  head: string;
  /** The repo's own checkout (git lists it first), not an added worktree. */
  main: boolean;
  locked: boolean;
  bare: boolean;
}

/** Parse `git worktree list --porcelain`: blank-line-separated blocks of
 * `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<name>` or `detached`,
 * and optional `bare`/`locked`/`prunable` flags. */
export function parseWorktrees(out: string): Worktree[] {
  const trees: Worktree[] = [];
  for (const block of out.split(/\n\s*\n+/)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
    if (!path) continue;
    const ref = lines.find((l) => l.startsWith("branch "))?.slice(7);
    trees.push({
      path,
      branch: ref ? ref.replace(/^refs\/heads\//, "") : null,
      head: lines.find((l) => l.startsWith("HEAD "))?.slice(5, 12) ?? "",
      // git always lists the repo's own checkout first.
      main: trees.length === 0,
      locked: lines.some((l) => l === "locked" || l.startsWith("locked ")),
      bare: lines.includes("bare"),
    });
  }
  return trees;
}

/** Every checkout of `repo` — its own working copy first, then added worktrees. */
export function listWorktrees(repo: string): Worktree[] {
  return parseWorktrees(git(repo, ["worktree", "list", "--porcelain"]));
}

/** Where den puts the worktrees it creates, under the repo. The folder is how
 * den knows it made one: it never offers to remove Claude Code's
 * `.claude/worktrees/` or hand-made ones. */
export const DEN_WORKTREE_DIR = ".claude-worktrees";

/** Did den create this worktree? Never true for the folder itself or the
 * repo's own checkout. */
export function isDenWorktree(repo: string, path: string): boolean {
  const root = join(repo, DEN_WORKTREE_DIR) + sep;
  return path.startsWith(root) && path.length > root.length;
}

/** A worktree as the cleanup UI sees it: whether den made it, and, for one it
 * did, what removing it would lose and whether a session is working in it.
 * `changes` is null when the folder is gone (a prunable worktree). */
export interface WorktreeInfo extends Worktree {
  den: boolean;
  changes?: WorktreeChanges | null;
  inUse?: boolean;
}

/** What removing a worktree would cost. Removing keeps the branch, so only
 * `dirty` (uncommitted `git status` lines) is lost, plus `unpushed` commits on
 * a detached HEAD, which no branch holds. */
export interface WorktreeChanges {
  dirty: number;
  /** Commits on HEAD that no remote branch has. */
  unpushed: number;
  detached: boolean;
}

/** Would removing a worktree with these changes lose work? */
export function losesWork(c: WorktreeChanges): boolean {
  return c.dirty > 0 || (c.detached && c.unpushed > 0);
}

export function worktreeChanges(path: string): WorktreeChanges {
  const status = git(path, ["status", "--porcelain"]);
  let unpushed = 0;
  try {
    unpushed = Number(git(path, ["rev-list", "--count", "HEAD", "--not", "--remotes"])) || 0;
  } catch {
    // no commits yet
  }
  let detached = false;
  try {
    git(path, ["symbolic-ref", "--quiet", "HEAD"]);
  } catch {
    detached = true;
  }
  return { dirty: status ? status.split("\n").length : 0, unpushed, detached };
}

/** Remove a den-created worktree, keeping its branch. `force` means the
 * caller has shown the developer what would be lost. */
export function removeWorktree(repo: string, path: string, force: boolean): void {
  if (!isDenWorktree(repo, path)) throw new Error("not_den_worktree");
  if (!listWorktrees(repo).some((w) => w.path === path)) throw new Error("not_a_worktree");
  if (!force && losesWork(worktreeChanges(path))) throw new Error("would_lose_work");
  git(repo, ["worktree", "remove", ...(force ? ["--force"] : []), path]);
}

/** If a branch is already checked out in a worktree, return that path. */
function worktreeForBranch(repo: string, branch: string): string | null {
  try {
    return listWorktrees(repo).find((w) => w.branch === branch)?.path ?? null;
  } catch {
    // not a repo / no worktrees
    return null;
  }
}

function branchExists(repo: string, branch: string): boolean {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** Branch names to try as the base for a new branch, most trusted first. The
 * override (see `baseBranchOverride` in fs.ts) exists because the branch a
 * team works off is not always the one GitHub calls the default. Invalid
 * names are dropped because each one reaches git as an argument. */
export function baseCandidates(
  override: string | null | undefined,
  repoDefault: string | null | undefined,
): string[] {
  const names = [override, repoDefault, "master", "main"].filter(
    (n): n is string => !!n && isValidBranch(n),
  );
  return [...new Set(names)];
}

/** The first candidate that resolves, preferring the freshly fetched
 * `origin/<name>` over a local branch that may be stale. */
export function pickBaseRef(
  names: string[],
  hasRef: (ref: string) => boolean,
): string | null {
  for (const name of names) {
    for (const ref of [`origin/${name}`, name]) {
      if (hasRef(ref)) return ref;
    }
  }
  return null;
}

/** The branch `origin/HEAD` points at, set when the repo was cloned. */
function remoteHeadBranch(repo: string): string | null {
  try {
    const ref = git(repo, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
    return ref.replace(/^origin\//, "") || null;
  } catch {
    return null; // never set, or no origin
  }
}

/** GitHub's default branch for the repo, for a clone whose `origin/HEAD` was
 * never set. A network call, so it's only made when the local answer is
 * missing. */
function githubDefaultBranch(repo: string): string | null {
  try {
    const out = execFileSync(
      "gh",
      ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"],
      { cwd: repo, encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
    return out || null;
  } catch {
    return null; // not a GitHub repo, gh not authed, offline
  }
}

/** The repo's base branch name for a label ("off development"), without the
 * network: the override, else `origin/HEAD`. Null when neither is known, and
 * the UI says "the repo's base branch" instead. */
export function repoBaseName(repo: string, override?: string | null): string | null {
  return override || remoteHeadBranch(repo);
}

function hasRef(repo: string, ref: string): boolean {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

/** The ref a new branch starts from: the repo's base branch, freshly
 * fetched. */
export function baseRef(repo: string, override?: string | null): string {
  const repoDefault = override ? null : (remoteHeadBranch(repo) ?? githubDefaultBranch(repo));
  const names = baseCandidates(override, repoDefault);
  try {
    execFileSync("git", ["-C", repo, "fetch", "origin", names[0], "--quiet"], {
      timeout: 30000,
      stdio: "ignore",
    });
  } catch {
    // offline / no origin / no such branch there: fall back to whatever's local
  }
  const ref = pickBaseRef(names, (r) => hasRef(repo, r));
  if (override && ref !== `origin/${override}` && ref !== override) {
    logWarn("git.baseRef", `base branch "${override}" not found in ${repo}; using ${ref ?? "HEAD"}`);
  }
  if (ref) return ref;
  // Nothing resolved: branching off HEAD may not be what the user wants (e.g. a
  // detached or unexpected checkout), so make the fallback visible.
  logWarn("git.baseRef", `no base branch found in ${repo}; falling back to HEAD`);
  return "HEAD";
}

export type WorkEnv = "local" | "worktree";

/** Check out a branch to work on, locally or in a new worktree, creating it
 * if needed, and return the directory to open Claude in. `stackOn` starts a
 * new branch from another ticket's branch (#26), using the local ref because
 * that ticket usually has unpushed commits. An existing branch is reused
 * as it is. */
export function prepareWork(
  repo: string,
  branch: string,
  env: WorkEnv,
  baseOverride?: string | null,
  stackOn?: string | null,
): { cwd: string } {
  assertValidBranch(branch);
  // Reuse a worktree that already has the branch (e.g. Claude Code's own):
  // git refuses to check out a branch twice.
  const existingWt = worktreeForBranch(repo, branch);
  if (existingWt) return { cwd: existingWt };

  const exists = branchExists(repo, branch);
  const base = () => {
    if (!stackOn) return baseRef(repo, baseOverride);
    assertValidBranch(stackOn);
    if (!branchExists(repo, stackOn)) throw new Error("no_such_base");
    return stackOn;
  };

  if (env === "worktree") {
    const leaf = branch.replace(/[/\\]/g, "-");
    const dir = join(repo, DEN_WORKTREE_DIR, leaf);
    if (existsSync(dir)) return { cwd: dir };
    if (exists) {
      git(repo, ["worktree", "add", dir, branch]);
    } else {
      git(repo, ["worktree", "add", dir, "-b", branch, base()]);
    }
    return { cwd: dir };
  }

  if (exists) {
    git(repo, ["checkout", branch]);
  } else {
    git(repo, ["checkout", "-b", branch, base()]);
  }
  return { cwd: repo };
}

/** Check out a PR with `gh pr checkout`, which handles forks. */
export function checkoutPr(
  repoDir: string,
  ghRepo: string,
  number: number,
  env: WorkEnv,
  branch?: string,
): { cwd: string } {
  // A non-integer PR number would flow into the worktree path (`pr-${number}`)
  // and the `gh` positional — reject it before either.
  if (!Number.isInteger(number) || number <= 0) throw new Error("invalid_pr");
  if (branch) {
    const existingWt = worktreeForBranch(repoDir, branch);
    if (existingWt) return { cwd: existingWt };
  }
  if (env === "worktree") {
    const dir = join(repoDir, DEN_WORKTREE_DIR, `pr-${number}`);
    if (!existsSync(dir)) {
      git(repoDir, ["worktree", "add", "--detach", dir]);
    }
    execFileSync("gh", ["pr", "checkout", String(number), "--repo", ghRepo], {
      cwd: dir,
      timeout: 60000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { cwd: dir };
  }
  execFileSync("gh", ["pr", "checkout", String(number), "--repo", ghRepo], {
    cwd: repoDir,
    timeout: 60000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { cwd: repoDir };
}
