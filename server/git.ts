import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { logWarn } from "./log.ts";
import { isValidBranch } from "../shared/branch.ts";

// The branch-name rule lives in shared/ so the New Session dialog can apply it
// too; re-exported here because git.ts is where the server reaches for it.
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

/**
 * One checkout of a repo — the primary working copy or an added worktree.
 * These are what den calls "workspaces" in the UI: the New Session dialog lists
 * them so a Work session can join one you already have instead of making
 * another.
 */
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

/**
 * Parse `git worktree list --porcelain`. Each record is a blank-line-separated
 * block starting with `worktree <path>`, then `HEAD <sha>` and either
 * `branch refs/heads/<name>` or `detached`, plus optional `bare`/`locked`/
 * `prunable` flags. Split out from the git call so it can be unit-tested.
 */
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

/**
 * Branch names to try as the base for a new branch, most trusted first: the
 * configured override (`base_branch`, see `baseBranchOverride` in fs.ts), then
 * the repo's own default branch, then `master` and `main` as a last resort.
 * Deduped, and names that fail `isValidBranch` are dropped, since each one
 * reaches git as an argument.
 *
 * The override exists because the branch a team works off is not always the
 * one GitHub calls the default. Pure, for the test.
 */
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
 * remote-tracking ref (`origin/<name>`) over a local branch that may be stale.
 * Null when none resolves. Pure (the lookup is passed in), for the test. */
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

/** The branch `origin/HEAD` points at, set when the repo was cloned. Local
 * and cheap, so it's asked first. */
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

function hasRef(repo: string, ref: string): boolean {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

/**
 * The ref a new branch starts from: the repo's base branch, freshly fetched.
 * Resolved from the override, then `origin/HEAD`, then GitHub's default
 * branch, then `master`/`main` (see `baseCandidates`). A repo based on
 * `development` used to get a branch off a stale `master`, or off HEAD when
 * there was no master, because only master/main were ever tried.
 */
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

/**
 * Prepare a branch to work on and return the directory to open Claude in.
 * - "local": checkout the branch in the repo itself.
 * - "worktree": add a git worktree under <repo>/.claude-worktrees/<branch> so
 *   several tickets can run in parallel without touching the main checkout.
 * The branch is created (from a fresh base, see baseRef) if it doesn't exist
 * yet. `baseOverride` is the configured base branch, if any.
 */
export function prepareWork(
  repo: string,
  branch: string,
  env: WorkEnv,
  baseOverride?: string | null,
): { cwd: string } {
  assertValidBranch(branch);
  // If the branch already lives in a worktree (e.g. Claude Code's own), reuse it
  // rather than creating a duplicate or erroring that it's already checked out.
  const existingWt = worktreeForBranch(repo, branch);
  if (existingWt) return { cwd: existingWt };

  const exists = branchExists(repo, branch);

  if (env === "worktree") {
    const leaf = branch.replace(/[/\\]/g, "-");
    const dir = join(repo, ".claude-worktrees", leaf);
    if (existsSync(dir)) return { cwd: dir };
    if (exists) {
      git(repo, ["worktree", "add", dir, branch]);
    } else {
      git(repo, ["worktree", "add", dir, "-b", branch, baseRef(repo, baseOverride)]);
    }
    return { cwd: dir };
  }

  // local
  if (exists) {
    git(repo, ["checkout", branch]);
  } else {
    git(repo, ["checkout", "-b", branch, baseRef(repo, baseOverride)]);
  }
  return { cwd: repo };
}

/**
 * Check out a PR (by number) so Claude has the code — for reviewing others' PRs
 * or editing your own. Uses `gh pr checkout`, which handles forks.
 */
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
  // Reuse an existing worktree for the PR's branch if there is one.
  if (branch) {
    const existingWt = worktreeForBranch(repoDir, branch);
    if (existingWt) return { cwd: existingWt };
  }
  if (env === "worktree") {
    const dir = join(repoDir, ".claude-worktrees", `pr-${number}`);
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
