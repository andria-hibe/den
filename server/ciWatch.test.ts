import { describe, it, expect } from "vitest";
import type { PullRequest } from "./github.ts";
import { ciFinishes } from "./ciWatch.ts";

const pr = (checks: PullRequest["checks"]) => ({ repo: "o/r", number: 7, checks }) as PullRequest;

describe("ciFinishes", () => {
  it("reports pending -> result once, and nothing on first sight", () => {
    const last = new Map();
    expect(ciFinishes(last, [pr("failing")])).toEqual([]);
    expect(ciFinishes(last, [pr("pending")])).toEqual([]);
    expect(ciFinishes(last, [pr("passing")]).map((f) => f.to)).toEqual(["passing"]);
    expect(ciFinishes(last, [pr("passing")])).toEqual([]);
  });
});
