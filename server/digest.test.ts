import { describe, expect, it } from "vitest";
import { pickupPrs, sharedFailures } from "./digest.ts";
import type { PullRequest, TeamPr } from "./github.ts";

const pr = (number: number, names: string[]) =>
  ({ number, failingChecks: names.map((name) => ({ name })) }) as unknown as PullRequest;

describe("sharedFailures", () => {
  it("names a check failing on more than one PR, and nothing failing on just one", () => {
    expect(sharedFailures([pr(1, ["Install Node Modules", "Lint"]), pr(2, ["Install Node Modules"]), pr(3, [])])).toEqual([
      { check: "Install Node Modules", prs: [1, 2] },
    ]);
  });
});

describe("pickupPrs", () => {
  const team = (number: number, branch: string, checks: TeamPr["checks"]) => ({ number, branch, checks }) as TeamPr;
  it("drops failing CI and PRs a session is on, by branch or number", () => {
    const prs = [team(1, "a", "passing"), team(2, "b", "failing"), team(3, "c", "pending"), team(4, "d", "none"), team(5, "e", "passing")];
    expect(pickupPrs(prs, [{ branch: "c", pr: null }, { branch: null, pr: 4 }]).map((p) => p.number)).toEqual([1, 5]);
  });
});
