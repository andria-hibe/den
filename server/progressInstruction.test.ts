import { describe, it, expect } from "vitest";
import { progressInstruction, isAscii } from "./sessions.ts";
import { HANDOVER_HEADINGS, SESSION_NOTES_HEADING } from "../shared/handover.ts";

const NOTEPAD = "/Users/x/.den/progress/abc-123.md";
const INSTRUCTION = progressInstruction(NOTEPAD);

describe("progressInstruction", () => {
  it("is itself pure ASCII, so it never teaches the model an em dash", () => {
    expect(isAscii(INSTRUCTION)).toBe(true);
  });

  it("names the notepad", () => {
    expect(INSTRUCTION).toContain(NOTEPAD);
  });

  it("tells a restarted session to read what it already wrote", () => {
    expect(INSTRUCTION).toContain("Read it before you start");
  });

  it("asks for the four handover sections, rewritten in place, not a log", () => {
    for (const h of HANDOVER_HEADINGS) expect(INSTRUCTION).toContain(`"## ${h}"`);
    expect(INSTRUCTION).toContain("Rewrite it in place");
    expect(INSTRUCTION).toContain("Do not append a log.");
  });

  it("keeps technical detail out of the developer's sections", () => {
    expect(INSTRUCTION).toContain("no commit hashes");
    expect(INSTRUCTION).toContain("what you committed or pushed or which tests and checks you ran");
  });

  it("keeps full technical context in session notes for the next session", () => {
    expect(INSTRUCTION).toContain(`"## ${SESSION_NOTES_HEADING}"`);
    expect(INSTRUCTION).toContain("Write it for yourself, not for the developer");
    expect(INSTRUCTION).toContain("decisions and why they were made");
    expect(INSTRUCTION).toContain("the exact next step");
  });

  it("leaves the ticket below alone, and folds in an old log", () => {
    expect(INSTRUCTION).toContain("Leave everything below the session notes");
    expect(INSTRUCTION).toContain("fold it into this shape");
  });
});
