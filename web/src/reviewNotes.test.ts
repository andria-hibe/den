import { describe, it, expect } from "vitest";
import { parseReview, matchFile } from "./reviewNotes.ts";

const FILES = ["web/src/App.tsx", "server/git.ts", "server/sessions.ts"];
const SNAKE = [
  "apps/hasura/tests/queries/query_notification_subscriptions.test.ts",
  "apps/rails/db/migrate/20260805025238_add_notification_auto_subscribe_feature_flag.rb",
];

describe("matchFile", () => {
  it("matches an exact path", () => {
    expect(matchFile("server/git.ts", FILES)).toBe("server/git.ts");
  });
  it("matches a backticked / shortened path", () => {
    expect(matchFile("`src/App.tsx`", FILES)).toBe("web/src/App.tsx");
    expect(matchFile("App.tsx", FILES)).toBe("web/src/App.tsx");
  });
  it("matches a path followed by prose", () => {
    expect(matchFile("server/git.ts — 2 issues", FILES)).toBe("server/git.ts");
  });
  it("prefers the longer path when both could match", () => {
    expect(matchFile("web/src/App.tsx", FILES)).toBe("web/src/App.tsx");
  });
  it("ignores prose headings", () => {
    expect(matchFile("Potential bugs", FILES)).toBeNull();
    expect(matchFile("", FILES)).toBeNull();
  });
  it("keeps underscores in a path (they are not emphasis here)", () => {
    expect(matchFile(SNAKE[0], SNAKE)).toBe(SNAKE[0]);
    expect(matchFile("query_notification_subscriptions.test.ts", SNAKE)).toBe(SNAKE[0]);
    expect(matchFile(`**${SNAKE[1]}**`, SNAKE)).toBe(SNAKE[1]);
  });
  it("still strips matched emphasis and a File: prefix", () => {
    expect(matchFile("**`server/git.ts`**", FILES)).toBe("server/git.ts");
    expect(matchFile("_server/git.ts_", FILES)).toBe("server/git.ts");
    expect(matchFile("**File:** server/git.ts", FILES)).toBe("server/git.ts");
  });
});

describe("parseReview", () => {
  it("splits the overall review from per-file sections", () => {
    const md = [
      "## Overall",
      "Looks solid overall.",
      "",
      "## `server/git.ts`",
      "- line 12: unvalidated branch name",
      "",
      "## web/src/App.tsx",
      "- nit: dead state",
    ].join("\n");
    const { overall, byFile } = parseReview(md, FILES);
    expect(overall).toBe("Looks solid overall.");
    expect(byFile["server/git.ts"]).toBe("- line 12: unvalidated branch name");
    expect(byFile["web/src/App.tsx"]).toBe("- nit: dead state");
    expect(byFile["server/sessions.ts"]).toBeUndefined();
  });

  it("keeps non-file headings as overall content", () => {
    const md = "Summary line.\n\n## Potential bugs\n- one\n\n## server/git.ts\n- two";
    const { overall, byFile } = parseReview(md, FILES);
    expect(overall).toBe("Summary line.\n\n## Potential bugs\n- one");
    expect(byFile["server/git.ts"]).toBe("- two");
  });

  it("keeps sub-headings inside a file section", () => {
    const md = "## server/git.ts\n### Bugs\n- one";
    expect(parseReview(md, FILES).byFile["server/git.ts"]).toBe("### Bugs\n- one");
  });

  it("does not treat a # inside a fenced block as a heading", () => {
    const md = [
      "## server/git.ts",
      "```sh",
      "# not a heading",
      "## web/src/App.tsx",
      "```",
      "- real note",
    ].join("\n");
    const { byFile } = parseReview(md, FILES);
    expect(byFile["web/src/App.tsx"]).toBeUndefined();
    expect(byFile["server/git.ts"]).toContain("# not a heading");
    expect(byFile["server/git.ts"]).toContain("- real note");
  });

  it("puts everything in overall when no file headings are used", () => {
    const md = "Just prose about the PR.";
    expect(parseReview(md, FILES)).toEqual({ overall: md, byFile: {} });
  });

  it("drops a file heading with no body", () => {
    const md = "Intro.\n\n## server/git.ts\n\n## web/src/App.tsx\n- note";
    const { byFile } = parseReview(md, FILES);
    expect(byFile["server/git.ts"]).toBeUndefined();
    expect(byFile["web/src/App.tsx"]).toBe("- note");
  });

  it("does not spill a snake_case file's notes into the previous file", () => {
    const md = [
      "## " + SNAKE[0],
      "- line 104: assert on the message",
      "",
      "## " + SNAKE[1],
      "- line 10: matches the existing pattern",
    ].join("\n");
    const { overall, byFile } = parseReview(md, SNAKE);
    expect(overall).toBe("");
    expect(byFile[SNAKE[0]]).toBe("- line 104: assert on the message");
    expect(byFile[SNAKE[1]]).toBe("- line 10: matches the existing pattern");
  });

  it("moves notes on a path outside the diff to overall, not the previous file", () => {
    const md = "## server/git.ts\n- one\n\n## server/other.ts\n- not in this diff";
    const { overall, byFile } = parseReview(md, FILES);
    expect(byFile["server/git.ts"]).toBe("- one");
    expect(overall).toBe("## server/other.ts\n- not in this diff");
  });

  it("handles an empty / unwritten notepad", () => {
    expect(parseReview("", FILES)).toEqual({ overall: "", byFile: {} });
  });
});
