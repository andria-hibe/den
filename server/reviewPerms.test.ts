import { describe, it, expect } from "vitest";
import { buildReviewPermissions, scratchBranch } from "./sessions.ts";

const NOTEPAD = "/Users/x/.den/progress/abc-123.md";

describe("buildReviewPermissions (PR review guardrails)", () => {
  const { permissions } = buildReviewPermissions(NOTEPAD);

  it("leaves the shell available — a review needs to run things", () => {
    expect(permissions.deny).not.toContain("Bash");
    expect(permissions.deny.some((r) => r === "Bash(:*)")).toBe(false);
  });

  it("denies pushing and committing in any form", () => {
    expect(permissions.deny).toContain("Bash(git push:*)");
    expect(permissions.deny).toContain("Bash(git commit:*)");
  });

  it("denies the gh subcommands that write to GitHub", () => {
    for (const sub of ["merge", "review", "comment", "edit", "close", "reopen", "ready"]) {
      expect(permissions.deny).toContain(`Bash(gh pr ${sub}:*)`);
    }
    expect(permissions.deny).toContain("Bash(gh api:*)");
    expect(permissions.deny).toContain("Bash(gh issue comment:*)");
  });

  it("keeps the gh read paths open (nothing denies pr view/diff/checks)", () => {
    for (const read of ["gh pr view", "gh pr diff", "gh pr checks"]) {
      expect(permissions.deny.some((r) => r.startsWith(`Bash(${read}`))).toBe(false);
    }
  });

  it("allows editing the exact notepad file, root-anchored and not a wildcard", () => {
    expect(permissions.allow).toContain(`Edit(//${NOTEPAD.replace(/^\/+/, "")})`);
    expect(permissions.allow[0]).not.toContain("**");
  });

  it("allows the read-only commands a review runs constantly", () => {
    for (const cmd of ["git log", "git show", "git diff", "git status", "git blame", "git grep", "git fetch", "rg", "grep", "gh pr view", "gh pr diff", "gh pr checks"]) {
      expect(permissions.allow).toContain(`Bash(${cmd}:*)`);
    }
  });

  it("never allows a command the deny list guards (deny still wins anyway)", () => {
    for (const guarded of ["git push", "git commit", "gh api", "gh pr merge", "gh pr review", "gh pr comment", "gh issue"]) {
      expect(permissions.allow.some((r) => r.includes(guarded))).toBe(false);
    }
  });

  it("grants Edit only on the notepad — no other Edit or Write allows", () => {
    const edits = permissions.allow.filter((r) => !r.startsWith("Bash("));
    expect(edits).toEqual([`Edit(//${NOTEPAD.replace(/^\/+/, "")})`]);
  });
});

describe("scratchBranch", () => {
  it("prefixes the PR's branch, so the PR's own branch never carries edits", () => {
    expect(scratchBranch("fast-1234-add-thing")).toBe(
      "andria/changes-to-fast-1234-add-thing",
    );
  });
  it("falls back when the branch is unknown", () => {
    expect(scratchBranch(null)).toBe("andria/changes-to-this-pr");
    expect(scratchBranch("")).toBe("andria/changes-to-this-pr");
  });
});
