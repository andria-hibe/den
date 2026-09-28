import { describe, it, expect } from "vitest";
import { progressInstruction, isAscii } from "./sessions.ts";

const NOTEPAD = "/Users/x/.den/progress/abc-123.md";
const INSTRUCTION = progressInstruction(NOTEPAD);

describe("progressInstruction", () => {
  it("is itself pure ASCII, so it never teaches the model an em dash", () => {
    expect(isAscii(INSTRUCTION)).toBe(true);
  });

  it("names the notepad", () => {
    expect(INSTRUCTION).toContain(NOTEPAD);
  });

  it("tells a restarted session to read what it already logged", () => {
    expect(INSTRUCTION).toContain("already has entries, read it before you start");
  });

  it("keeps the log append-only", () => {
    expect(INSTRUCTION).toContain("never delete earlier ones");
  });
});
