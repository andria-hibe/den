import { describe, it, expect } from "vitest";
import { baseCandidates, isValidBranch, parseWorktrees, pickBaseRef } from "./git.ts";

describe("isValidBranch", () => {
  it("accepts normal branch names", () => {
    expect(isValidBranch("fast-6115-fix-thing")).toBe(true);
    expect(isValidBranch("andria/fast-6115")).toBe(true);
    expect(isValidBranch("release/1.2.x")).toBe(true);
  });

  it("rejects a leading dash (would be read as a git flag)", () => {
    expect(isValidBranch("--force")).toBe(false);
    expect(isValidBranch("-b")).toBe(false);
  });

  it("rejects shell/path metacharacters", () => {
    expect(isValidBranch("foo;rm -rf ~")).toBe(false);
    expect(isValidBranch("foo bar")).toBe(false);
    expect(isValidBranch("foo$(whoami)")).toBe(false);
    expect(isValidBranch("../escape")).toBe(false);
  });

  it("rejects '..' anywhere (ref traversal)", () => {
    expect(isValidBranch("a..b")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidBranch("")).toBe(false);
  });
});

describe("parseWorktrees", () => {
  const out = [
    "worktree /Users/a/Documents/work/runn",
    "HEAD 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
    "branch refs/heads/master",
    "",
    "worktree /Users/a/Documents/work/runn/.claude-worktrees/fast-6115",
    "HEAD 0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b1a",
    "branch refs/heads/andria/fast-6115",
    "",
    "worktree /Users/a/Documents/work/runn/.claude-worktrees/pr-20662",
    "HEAD abcdef01234567890abcdef01234567890abcdef",
    "detached",
    "",
  ].join("\n");

  it("reads path, branch and short head for each checkout", () => {
    const trees = parseWorktrees(out);
    expect(trees).toHaveLength(3);
    expect(trees[0]).toMatchObject({
      path: "/Users/a/Documents/work/runn",
      branch: "master",
      head: "1a2b3c4",
    });
    expect(trees[1].branch).toBe("andria/fast-6115");
  });

  it("marks only the first entry as the repo's own checkout", () => {
    const trees = parseWorktrees(out);
    expect(trees.map((w) => w.main)).toEqual([true, false, false]);
  });

  it("reports a detached worktree with a null branch", () => {
    expect(parseWorktrees(out)[2].branch).toBe(null);
  });

  it("flags bare and locked worktrees", () => {
    const trees = parseWorktrees(
      "worktree /repo.git\nbare\n\nworktree /wt\nHEAD abc123def456\nbranch refs/heads/x\nlocked in use\n",
    );
    expect(trees[0].bare).toBe(true);
    expect(trees[1].locked).toBe(true);
  });

  it("returns nothing for empty output", () => {
    expect(parseWorktrees("")).toEqual([]);
  });
});

describe("baseCandidates", () => {
  it("tries the override, then the repo default, then master and main", () => {
    expect(baseCandidates("release", "development")).toEqual(["release", "development", "master", "main"]);
  });

  it("dedupes, so a repo whose default is master tries it once", () => {
    expect(baseCandidates(null, "master")).toEqual(["master", "main"]);
  });

  it("drops a name git would read as a flag", () => {
    expect(baseCandidates("--orphan", "development")).toEqual(["development", "master", "main"]);
  });
});

describe("pickBaseRef", () => {
  const refs = (...have: string[]) => (r: string) => have.includes(r);

  it("prefers the fetched remote ref over a stale local branch", () => {
    expect(pickBaseRef(["development"], refs("development", "origin/development"))).toBe("origin/development");
  });

  it("uses the local branch when there is no remote", () => {
    expect(pickBaseRef(["development"], refs("development"))).toBe("development");
  });

  it("takes the repo's base over a stale master that still exists", () => {
    const names = baseCandidates(null, "development");
    expect(pickBaseRef(names, refs("master", "origin/master", "origin/development"))).toBe("origin/development");
  });

  it("falls through to master when the default can't be found", () => {
    expect(pickBaseRef(["development", "master", "main"], refs("origin/master"))).toBe("origin/master");
  });

  it("is null when nothing resolves (baseRef then uses HEAD)", () => {
    expect(pickBaseRef(["development", "master", "main"], refs())).toBeNull();
  });
});
