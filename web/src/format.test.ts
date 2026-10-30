import { describe, it, expect } from "vitest";
import { formatTokens } from "./format.ts";

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(208588)).toBe("209k");
    expect(formatTokens(51744671)).toBe("51.7M");
  });
});
