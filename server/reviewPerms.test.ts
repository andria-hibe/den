import { describe, it, expect } from "vitest";
import { buildReviewPermissions } from "./sessions.ts";

const WORKTREE = "/Users/x/Documents/work/runn/.claude-worktrees/pr-123";
const NOTEPAD = "/Users/x/.den/progress/abc-123.md";

describe("buildReviewPermissions (read-only PR review lockdown)", () => {
  const { permissions } = buildReviewPermissions(WORKTREE, NOTEPAD);

  it("denies the Bash tool outright (no shell → no git/gh writes, sed -i, redirects)", () => {
    expect(permissions.deny).toContain("Bash");
  });

  it("denies edits anywhere in the worktree, root-anchored with a /** wildcard", () => {
    expect(permissions.deny).toContain(`Edit(//${WORKTREE.replace(/^\/+/, "")}/**)`);
  });

  it("allows editing ONLY the exact notepad file, outside the worktree", () => {
    expect(permissions.allow).toEqual([`Edit(//${NOTEPAD.replace(/^\/+/, "")})`]);
    // The single allow must not be a broad wildcard.
    expect(permissions.allow[0]).not.toContain("**");
  });

  it("does not allow any write path inside the worktree (deny > allow anyway)", () => {
    for (const rule of permissions.allow) {
      expect(rule.includes(WORKTREE)).toBe(false);
    }
  });

  it("emits Claude's // root-anchored absolute specifier (double slash)", () => {
    expect(permissions.deny.some((r) => r.startsWith("Edit(//"))).toBe(true);
    expect(permissions.allow[0].startsWith("Edit(//")).toBe(true);
  });

  it("grants no other mutating capability (only Bash + worktree Edit are denied, nothing extra allowed)", () => {
    expect(permissions.deny).toHaveLength(2);
    expect(permissions.allow).toHaveLength(1);
  });
});
