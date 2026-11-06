import { describe, expect, it } from "vitest";
import { pickupPrs, sharedFailures, tagReviewRequests } from "./digest.ts";
import type { GhNotification, PullRequest, TeamPr } from "./github.ts";

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

describe("tagReviewRequests", () => {
  const note = (reason: string, n: number) =>
    ({ reason, type: "PullRequest", title: `PR ${n}`, repo: "o/r", url: `https://github.com/o/r/pull/${n}`, updatedAt: "" }) as GhNotification;
  const named = [{ repo: "o/r", number: 1, reviewRequestedFromMe: true }, { repo: "o/r", number: 2, reviewRequestedFromMe: false }] as PullRequest[];
  const team = [{ repo: "o/r", number: 3 }] as TeamPr[];
  it("tags named and team requests, drops ones no longer open to the developer, and leaves other reasons alone", () => {
    const out = tagReviewRequests([note("review_requested", 1), note("review_requested", 2), note("review_requested", 3), note("mention", 4)], named, team);
    expect(out.map((n) => [n.title, n.requested])).toEqual([["PR 1", "named"], ["PR 3", "team"], ["PR 4", undefined]]);
  });
});
