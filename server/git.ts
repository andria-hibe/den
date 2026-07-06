import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function git(cwd: string, args: string[], timeout = 20000): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function branchExists(repo: string, branch: string): boolean {
  try {
    git(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

/** Freshly-fetched origin/master if possible, else local master, else HEAD. */
function baseRef(repo: string): string {
  try {
    execFileSync("git", ["-C", repo, "fetch", "origin", "master", "--quiet"], {
      timeout: 30000,
      stdio: "ignore",
    });
  } catch {
    // offline / no origin — fall back to whatever's local
  }
  for (const ref of ["origin/master", "master", "origin/main", "main"]) {
    try {
      git(repo, ["rev-parse", "--verify", "--quiet", ref]);
      return ref;
    } catch {
      // try next
    }
  }
  return "HEAD";
}

export type WorkEnv = "local" | "worktree";

/**
 * Prepare a branch to work on and return the directory to open Claude in.
 * - "local": checkout the branch in the repo itself.
 * - "worktree": add a git worktree under <repo>/.claude-worktrees/<branch> so
 *   several tickets can run in parallel without touching the main checkout.
 * The branch is created (from a fresh base) if it doesn't exist yet.
 */
export function prepareWork(
  repo: string,
  branch: string,
  env: WorkEnv,
): { cwd: string } {
  const exists = branchExists(repo, branch);

  if (env === "worktree") {
    const leaf = branch.replace(/[/\\]/g, "-");
    const dir = join(repo, ".claude-worktrees", leaf);
    if (existsSync(dir)) return { cwd: dir };
    if (exists) {
      git(repo, ["worktree", "add", dir, branch]);
    } else {
      git(repo, ["worktree", "add", dir, "-b", branch, baseRef(repo)]);
    }
    return { cwd: dir };
  }

  // local
  if (exists) {
    git(repo, ["checkout", branch]);
  } else {
    git(repo, ["checkout", "-b", branch, baseRef(repo)]);
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
): { cwd: string } {
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
