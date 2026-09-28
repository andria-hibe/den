import { describe, it, expect } from "vitest";
import { cleanRemovable, describeLoss, losesWork } from "./worktreeCleanup.ts";
import type { WorktreeInfo } from "../../server/git.ts";

const clean = { dirty: 0, unpushed: 0, detached: false };

describe("describeLoss", () => {
  it("says nothing is lost for a clean worktree", () => {
    expect(describeLoss(clean)).toBe("Nothing is lost. The branch stays.");
  });

  it("reassures that unpushed commits stay on the branch", () => {
    expect(describeLoss({ ...clean, unpushed: 2 })).toContain("branch keeps its 2 unpushed commits");
  });

  it("warns about uncommitted changes", () => {
    expect(describeLoss({ ...clean, dirty: 1 })).toBe("1 uncommitted change will be lost.");
  });

  it("warns about commits no branch holds on a detached HEAD", () => {
    expect(describeLoss({ dirty: 3, unpushed: 1, detached: true })).toBe(
      "3 uncommitted changes and 1 commit on no branch will be lost.",
    );
  });

  it("handles a worktree whose folder is gone", () => {
    expect(describeLoss(null)).toContain("already gone");
  });
});

describe("losesWork", () => {
  it("is false for unpushed commits on a branch, which survive removal", () => {
    expect(losesWork({ ...clean, unpushed: 4 })).toBe(false);
  });
  it("is true for uncommitted changes", () => {
    expect(losesWork({ ...clean, dirty: 1 })).toBe(true);
  });
});

describe("cleanRemovable", () => {
  const tree = (over: Partial<WorktreeInfo>): WorktreeInfo => ({
    path: "/r/.claude-worktrees/x", branch: "x", head: "abc", main: false, locked: false, bare: false,
    den: true, changes: clean, inUse: false, ...over,
  });

  it("keeps only den worktrees that are unused and lose nothing", () => {
    const trees = [
      tree({ path: "a" }),
      tree({ path: "b", inUse: true }),
      tree({ path: "c", changes: { ...clean, dirty: 2 } }),
      tree({ path: "d", den: false }),
      tree({ path: "e", changes: { ...clean, unpushed: 3 } }),
    ];
    expect(cleanRemovable(trees).map((t) => t.path)).toEqual(["a", "e"]);
  });
});
