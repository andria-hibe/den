import { describe, it, expect } from "vitest";
import { isAscii } from "../../shared/ascii.ts";
import type { LinearIssue } from "../../server/linear.ts";
import {
  autoReviewPrompt,
  denPrompt,
  fileReviewPrompt,
  guidePrompt,
  hunkRanges,
  notePrompt,
  reviewPrompt,
  ticketBrief,
  ticketNotesSeed,
  ticketPrompt,
} from "./prompts.ts";

const ISSUE: LinearIssue = {
  identifier: "FAST-1234",
  title: "Fix the thing",
  url: "https://linear.app/x/issue/FAST-1234",
  priority: 2,
  priorityLabel: "High",
  branchName: "andria/fast-1234-fix-the-thing",
  description: "It breaks.",
  state: { name: "Todo", type: "unstarted", color: "#fff" },
  updatedAt: "2026-09-01T00:00:00Z",
  ticketHint: "fast-1234",
};

const FILE_LINES = [
  "diff --git a/server/git.ts b/server/git.ts",
  "--- a/server/git.ts",
  "+++ b/server/git.ts",
  "@@ -10,4 +10,5 @@ export function prepareWork() {",
  "-const b = 2;",
  "+const b = 3; // “curly” in the source",
  "@@ -40,2 +41,2 @@",
  "-gone;",
];

describe("paste prompts", () => {
  // Every prompt den pastes into a pane that answers in ASCII is ASCII itself,
  // so it never teaches the model the characters reviewInstruction forbids.
  const prompts: Record<string, string> = {
    guidePrompt: guidePrompt(42, "org/repo"),
    reviewPrompt: reviewPrompt(42, "org/repo"),
    autoReviewPrompt: autoReviewPrompt(42, "org/repo"),
    fileReviewPrompt: fileReviewPrompt("server/git.ts", 42, FILE_LINES),
    ticketBrief: ticketBrief(ISSUE),
    ticketNotesSeed: ticketNotesSeed(ISSUE),
    ticketPrompt: ticketPrompt(ISSUE),
    denPrompt: denPrompt(),
    notePrompt: notePrompt(42, {
      kind: "line comment",
      author: "someone",
      body: "rename this",
      at: "2026-09-01T00:00:00Z",
      path: "server/git.ts",
      line: 12,
      diffHunk: "@@ -1,1 +1,1 @@\n-a\n+b",
    }),
  };
  for (const [name, text] of Object.entries(prompts)) {
    it(`${name} is pure ASCII`, () => {
      expect(isAscii(text)).toBe(true);
    });
  }

  it("the auto pre-review asks for the guide before the review", () => {
    const auto = prompts.autoReviewPrompt;
    expect(auto.indexOf("reading guide")).toBeLessThan(auto.indexOf("Please review"));
  });
});

describe("fileReviewPrompt", () => {
  const text = fileReviewPrompt("server/git.ts", 42, FILE_LINES);

  it("points at the saved diff instead of re-pasting the hunks", () => {
    expect(text).toContain("saved diff");
    expect(text).not.toContain("```diff");
    expect(text).not.toContain("const b = 3");
  });

  it("names the hunks without their (possibly non-ASCII) context", () => {
    expect(text).toContain("`@@ -10,4 +10,5 @@`");
    expect(text).toContain("`@@ -40,2 +41,2 @@`");
    expect(text).not.toContain("prepareWork");
  });

  it("keeps the answer out of the finished review", () => {
    expect(text).toContain("Answer here in the terminal");
    expect(text).toContain("leave the notepad review and the guide file");
  });
});

describe("hunkRanges", () => {
  it("returns each hunk header's range and nothing else", () => {
    expect(hunkRanges(FILE_LINES)).toEqual(["@@ -10,4 +10,5 @@", "@@ -40,2 +41,2 @@"]);
  });

  it("is empty for a file with no hunks (a pure rename or a binary)", () => {
    expect(hunkRanges(["diff --git a/x.png b/x.png", "Binary files differ"])).toEqual([]);
  });
});

describe("denPrompt", () => {
  it("drops the bold span but keeps the ground rules", () => {
    const text = denPrompt();
    expect(text).not.toContain("**");
    expect(text).toContain("./CLAUDE.md");
    expect(text).toContain("npm run pack");
    expect(text).toContain("wait for me");
  });
});

describe("ticketNotesSeed", () => {
  it("is the ticket brief plus a progress section", () => {
    const seed = ticketNotesSeed(ISSUE);
    expect(seed.startsWith(ticketBrief(ISSUE))).toBe(true);
    expect(seed).toContain("## Progress");
    expect(ticketBrief(ISSUE)).not.toContain("## Progress");
  });
});
