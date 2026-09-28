import { describe, it, expect } from "vitest";
import { isNearBottom } from "./NotepadPane.tsx";

describe("isNearBottom", () => {
  it("is true at the very bottom", () => {
    expect(isNearBottom(600, 400, 1000)).toBe(true);
  });

  it("allows a little slack for rounding and a trailing margin", () => {
    expect(isNearBottom(590.5, 400, 1000)).toBe(true);
  });

  it("is false once the reader has scrolled up to an older entry", () => {
    expect(isNearBottom(300, 400, 1000)).toBe(false);
  });

  it("is true when everything fits and nothing scrolls", () => {
    expect(isNearBottom(0, 400, 300)).toBe(true);
  });
});
