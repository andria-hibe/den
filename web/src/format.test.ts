import { describe, it, expect } from "vitest";
import { formatTokens, formatUSD } from "./format.ts";

describe("formatUSD", () => {
  it("shows cents under $100 and whole dollars above", () => {
    expect(formatUSD(0)).toBe("$0");
    expect(formatUSD(0.004)).toBe("<$0.01");
    expect(formatUSD(2.3643894)).toBe("$2.36");
    expect(formatUSD(1234.5)).toBe("$1,235");
  });
});

describe("formatTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(formatTokens(950)).toBe("950");
    expect(formatTokens(1234)).toBe("1.2k");
    expect(formatTokens(208588)).toBe("209k");
    expect(formatTokens(51744671)).toBe("51.7M");
  });
});
