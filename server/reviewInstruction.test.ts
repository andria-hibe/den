import { describe, it, expect } from "vitest";
import { reviewInstruction, isAscii } from "./sessions.ts";

const NOTEPAD = "/Users/x/.den/progress/abc-123.md";
const DIFF = "/Users/x/.den/review/abc-123.diff";
const GUIDE = "/Users/x/.den/review/abc-123.guide.md";
const INSTRUCTION = reviewInstruction(NOTEPAD, DIFF, "feature/thing", GUIDE);

describe("isAscii", () => {
  it("accepts plain ASCII, tabs and newlines", () => {
    expect(isAscii("path:12 - drop the cast, use `Number(x)`.\n\tok")).toBe(true);
  });

  it("rejects the characters that break a copy-paste", () => {
    for (const bad of ["em — dash", "curly ’", "smart “quote”", "arrow →", "nbsp here", "…", "🦊"]) {
      expect(isAscii(bad)).toBe(false);
    }
  });
});

describe("reviewInstruction", () => {
  it("is itself pure ASCII, so it never teaches the model an em dash", () => {
    expect(isAscii(INSTRUCTION)).toBe(true);
  });

  it("names the files it hands over", () => {
    expect(INSTRUCTION).toContain(NOTEPAD);
    expect(INSTRUCTION).toContain(DIFF);
    expect(INSTRUCTION).toContain(GUIDE);
  });

  it("keeps the three absolute guardrails", () => {
    expect(INSTRUCTION).toContain("NEVER commit");
    expect(INSTRUCTION).toContain("NEVER push");
    expect(INSTRUCTION).toContain("andria/changes-to-feature/thing");
  });

  it("demands ASCII output", () => {
    expect(INSTRUCTION).toContain("WRITE THE WHOLE REVIEW IN PLAIN ASCII");
  });

  it("demands short, ranked, per-file bullets", () => {
    expect(INSTRUCTION).toContain("KEEP THE WRITING SHORT AND DIRECT");
    expect(INSTRUCTION).toContain("at most 5 bullets");
    expect(INSTRUCTION).toContain('"## <file path>"');
  });

  it("keeps the review thorough even though the writing is terse", () => {
    expect(INSTRUCTION).toContain("JUST AS ");
    expect(INSTRUCTION).toContain("THOROUGHLY");
  });

  it("runs the code-review skill against the PR branch, banning the write flags", () => {
    expect(INSTRUCTION).toContain("code-review skill");
    expect(INSTRUCTION).toContain("branch (feature/thing)");
    expect(INSTRUCTION).toContain("--comment");
    expect(INSTRUCTION).toContain("--fix");
  });

  it("asks for the reading guide, grouped by purpose and ordered by importance", () => {
    expect(INSTRUCTION).toContain("THE READING GUIDE");
    expect(INSTRUCTION).toContain('"## <section title>"');
    expect(INSTRUCTION).toContain("most important first");
    expect(INSTRUCTION).toContain('"Files: path/one.ts, path/two.ts"');
    // The guide orients; findings belong to the review, which den files per file.
    expect(INSTRUCTION).toContain("it does not review");
    expect(INSTRUCTION).toContain("exactly one section");
  });

  it("still targets the checkout when the branch is unknown", () => {
    const noBranch = reviewInstruction(NOTEPAD, DIFF, null, GUIDE);
    expect(noBranch).toContain("checked-out branch");
    expect(isAscii(noBranch)).toBe(true);
  });
});
