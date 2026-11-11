import { describe, it, expect } from "vitest";
import { isAscii, toAscii } from "../../shared/ascii.ts";
import { lineChanges, restoreTicket, ticketDescription } from "../../shared/handover.ts";
import type { LinearIssue } from "../../server/linear.ts";
import {
  autoReviewPrompt,
  cleanupPrompt,
  crewAskPrompt,
  crewFor,
  denPrompt,
  fileReviewPrompt,
  guidePrompt,
  hunkRanges,
  lineAnswerPrompt,
  refreshReviewPrompt,
  notePrompt,
  reviewPrompt,
  ticketBrief,
  ticketDetails,
  ticketNotesSeed,
  ticketPrompt,
} from "./prompts.ts";

const ISSUE: LinearIssue = {
  identifier: "ABC-1234",
  title: "Fix the thing",
  url: "https://linear.app/x/issue/ABC-1234",
  priority: 2,
  priorityLabel: "High",
  branchName: "andria/abc-1234-fix-the-thing",
  description: "It breaks.",
  state: { name: "Todo", type: "unstarted", color: "#fff" },
  updatedAt: "2026-09-01T00:00:00Z",
  ticketHint: "abc-1234",
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
    autoReviewPromptOwned: autoReviewPrompt(42, "org/repo", true),
    autoReviewPromptBlockers: autoReviewPrompt(42, "org/repo", false, "blockers"),
    autoReviewPromptSaved: autoReviewPrompt(42, "org/repo", false, { name: "n", text: "Look at the migrations." }),
    fileReviewPrompt: fileReviewPrompt("server/git.ts", 42, FILE_LINES),
    ticketBrief: ticketBrief(ISSUE),
    ticketNotesSeed: ticketNotesSeed(ISSUE),
    ticketPrompt: ticketPrompt(ISSUE),
    denPrompt: denPrompt(),
    cleanupWithSkill: cleanupPrompt("team-cleanup"),
    cleanupGeneric: cleanupPrompt(null),
    refreshReview: refreshReviewPrompt(42, "o/r"),
    lineAnswer: lineAnswerPrompt("server/git.ts", 12, "Q: why?\nA: because."),
    ...Object.fromEntries(
      (["kit", "review", "manager"] as const).flatMap((pane) =>
        crewFor(pane).map((h) => [`crewAsk ${h} (${pane})`, crewAskPrompt(h, pane).text]),
      ),
    ),
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
    expect(text).toContain("leave the review file and the guide file");
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
  it("opens on the empty handover, with the ticket below it", () => {
    const seed = ticketNotesSeed(ISSUE);
    expect(seed.startsWith("# ABC-1234: Fix the thing\n\n## Where it stands")).toBe(true);
    expect(seed.indexOf("## Waiting on you")).toBeLessThan(seed.indexOf("## Session notes"));
    expect(seed.indexOf("## Session notes")).toBeLessThan(seed.indexOf("## Ticket"));
    expect(seed).toContain("It breaks.");
  });

  it("gets its ticket back after a rewrite drops it, and only then", () => {
    const seed = ticketNotesSeed(ISSUE);
    const ticket = ticketDetails(ISSUE);
    expect(restoreTicket(seed.replace(/\n{2,}/g, "\n\n\n"), ticket)).toBeNull();
    const dropped = seed.slice(0, seed.indexOf(ticket));
    expect(restoreTicket(dropped, ticket)).toContain("It breaks.");
  });

  it("keeps the look pane's brief free of the handover", () => {
    expect(ticketBrief(ISSUE)).not.toContain("## Where it stands");
    expect(ticketBrief(ISSUE)).toContain("It breaks.");
  });
});

describe("cleanupPrompt", () => {
  it("names the skill and keeps den's approval gate", () => {
    const text = cleanupPrompt("team-cleanup");
    expect(text).toContain("Use the team-cleanup skill");
    expect(text).toContain("change nothing until I approve it");
  });

  it("carries the safety rules when there's no skill", () => {
    const text = cleanupPrompt(null);
    expect(text).toContain("squash-merged");
    expect(text).toContain("change nothing until I approve it");
    expect(text).toContain("Never use --force or --hard");
  });
});

describe("ticket edits", () => {
  it("finds the description in the ticket section and lists what changed", () => {
    const section = ticketDetails({ ...ISSUE, description: "It breaks.\nOn Mondays." });
    expect(ticketDescription(section)).toBe("It breaks.\nOn Mondays.");
    expect(lineChanges("It breaks.\nOn Mondays.", "It breaks.\nOn Tuesdays.")).toEqual([
      "- On Mondays.",
      "+ On Tuesdays.",
    ]);
  });
});

describe("toAscii", () => {
  it("swaps typographic characters in a saved prompt and reports the rest", () => {
    const { text, left } = toAscii("Don’t “skip” tests — check… → \u{1F600}");
    expect(text).toBe("Don't \"skip\" tests - check... -> \u{1F600}");
    expect(left).toEqual(["\u{1F600}"]);
  });
});
