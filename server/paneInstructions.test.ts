import { describe, it, expect } from "vitest";
import {
  houseRules,
  isAscii,
  lookInstruction,
  myPrInstruction,
  testingRules,
  workspaceInstruction,
} from "./sessions.ts";

const NOTEPAD = "/Users/x/.den/progress/abc-123.md";

describe("houseRules", () => {
  const rules = houseRules();

  it("is pure ASCII and demands ASCII output", () => {
    expect(isAscii(rules)).toBe(true);
    expect(rules).toContain("plain ASCII");
  });

  it("opens every PR as a draft and never marks one ready", () => {
    expect(rules).toContain("--draft");
    expect(rules).toContain("gh pr create");
    expect(rules).toContain("Never run `gh pr ready`");
  });
});

describe("workspaceInstruction", () => {
  const text = workspaceInstruction(NOTEPAD);

  it("keeps the notepad wiring and adds the house rules", () => {
    expect(isAscii(text)).toBe(true);
    expect(text).toContain(NOTEPAD);
    expect(text).toContain("Read it before you start");
    expect(text).toContain(houseRules());
  });
});

describe("myPrInstruction", () => {
  const text = myPrInstruction(123, "org/repo", "andria/fast-1-thing");

  it("names the PR, the repo, and the branch", () => {
    expect(isAscii(text)).toBe(true);
    expect(text).toContain("pull request #123 (org/repo)");
    expect(text).toContain("branch andria/fast-1-thing");
  });

  it("carries the house rules, since its replies reach GitHub", () => {
    expect(text).toContain(houseRules());
    expect(text).toContain("don't post to GitHub yourself");
  });

  it("still reads when the PR context is missing", () => {
    const bare = myPrInstruction(null, null, null);
    expect(isAscii(bare)).toBe(true);
    expect(bare).toContain("the developer's own pull request, inside");
  });
});

describe("lookInstruction", () => {
  const text = lookInstruction("FAST-1234", "Fix the thing", NOTEPAD);

  it("names the ticket and points at the saved description", () => {
    expect(isAscii(text)).toBe(true);
    expect(text).toContain("FAST-1234: Fix the thing");
    expect(text).toContain(NOTEPAD);
    expect(text).toContain("don't edit it");
  });

  it("carries the house rules", () => {
    expect(text).toContain(houseRules());
  });
});

describe("testingRules", () => {
  it("is ASCII and reaches the panes that write code, not the one that only reads", () => {
    expect(isAscii(testingRules())).toBe(true);
    expect(workspaceInstruction("/n.md")).toContain(testingRules());
    expect(myPrInstruction(1, "o/r", "b")).toContain(testingRules());
    expect(lookInstruction("T-1", "t", "/n.md")).not.toContain(testingRules());
  });
});
