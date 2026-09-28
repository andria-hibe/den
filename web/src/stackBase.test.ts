import { describe, it, expect } from "vitest";
import { stackCandidates } from "./stackBase.ts";
import type { Worktree } from "../../server/git.ts";

const wt = (branch: string | null, main = false): Worktree => ({
  path: `/r/${branch}`, branch, head: "abc", main, locked: false, bare: false,
});

describe("stackCandidates", () => {
  it("offers the other open worktree branches", () => {
    const trees = [wt("development", true), wt("andria/fast-1-a"), wt("andria/fast-2-b")];
    expect(stackCandidates(trees, "andria/fast-3-c", "development")).toEqual([
      "andria/fast-1-a",
      "andria/fast-2-b",
    ]);
  });

  it("leaves out the branch being created, detached checkouts, and duplicates", () => {
    const trees = [wt("andria/fast-1-a"), wt(null), wt("andria/fast-1-a"), wt("andria/fast-3-c")];
    expect(stackCandidates(trees, "andria/fast-3-c", "development")).toEqual(["andria/fast-1-a"]);
  });

  it("offers the main checkout's branch when it is a feature branch, not the base", () => {
    expect(stackCandidates([wt("andria/fast-9-x", true)], "new", "development")).toEqual(["andria/fast-9-x"]);
  });
});
