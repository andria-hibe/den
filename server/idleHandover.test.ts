import { describe, it, expect } from "vitest";
import { IDLE_HANDOVER_MS, NOTEPAD_FRESH_MS, idleHandoverDue, idleHandoverPrompt, isAscii } from "./sessions.ts";

const NOW = 10_000_000_000;
const due = (over: Partial<Parameters<typeof idleHandoverDue>[0]> = {}) =>
  idleHandoverDue({
    now: NOW,
    idleMs: IDLE_HANDOVER_MS,
    lastOutputAt: NOW - IDLE_HANDOVER_MS - 1,
    lastInputAt: NOW - IDLE_HANDOVER_MS - 60_000,
    lastHandoverAt: 0,
    notepadMtime: NOW - IDLE_HANDOVER_MS - 10 * 60_000,
    ...over,
  });

describe("idleHandoverDue", () => {
  it("fires once a worked-in pane has been quiet for the idle window", () => {
    expect(due()).toBe(true);
  });

  it("waits until the pane has been quiet for the whole window", () => {
    expect(due({ lastOutputAt: NOW - IDLE_HANDOVER_MS + 1000 })).toBe(false);
  });

  it("fires once per idle period: not again until someone types", () => {
    // The handover already ran for this quiet spell.
    expect(due({ lastHandoverAt: NOW - 60_000 })).toBe(false);
    // Then someone worked in the pane, and it went quiet again.
    expect(
      due({ lastHandoverAt: NOW - 2 * 3600_000, lastInputAt: NOW - 3600_000, lastOutputAt: NOW - IDLE_HANDOVER_MS - 1 }),
    ).toBe(true);
  });

  it("never fires for a pane nobody has typed into", () => {
    expect(due({ lastInputAt: 0 })).toBe(false);
  });

  it("skips when the session already wrote its notepad at the end of the work", () => {
    expect(due({ notepadMtime: NOW - IDLE_HANDOVER_MS - NOTEPAD_FRESH_MS / 2 })).toBe(false);
  });

  it("is off when the window is 0", () => {
    expect(due({ idleMs: 0 })).toBe(false);
  });
});

describe("idleHandoverPrompt", () => {
  const text = idleHandoverPrompt("/Users/x/.den/progress/g.md");
  it("is ASCII and names the notepad", () => {
    expect(isAscii(text)).toBe(true);
    expect(text).toContain("/Users/x/.den/progress/g.md");
  });
  it("only touches the notepad", () => {
    expect(text).toContain("Do not run anything or change any other file.");
  });
});
