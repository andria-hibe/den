import { describe, expect, it } from "vitest";
import { pickupPrs, setAsideSnoozed, sharedFailures, tagReviewRequests } from "./digest.ts";
import type { GhNotification, PrBuckets, PullRequest, TeamPr } from "./github.ts";

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

describe("setAsideSnoozed", () => {
  it("takes snoozed PRs out of every list and lists them as put off, soonest first", () => {
    const p = (number: number) => ({ repo: "o/r", number, title: `t${number}`, url: `u${number}` }) as PullRequest;
    const prs = { authored: [p(1), p(2)], reviewRequested: [p(3)], fetchedAt: "" } as PrBuckets;
    const team = [{ repo: "o/r", number: 4, title: "t4", url: "u4" }] as TeamPr[];
    const r = setAsideSnoozed(prs, team, { "o/r#2": 200, "o/r#4": 100, "o/r#9": 300 });
    expect(r.prs?.authored.map((x) => x.number)).toEqual([1]);
    expect(r.teamPrs).toEqual([]);
    expect(r.later).toEqual([
      { key: "o/r#4", title: "t4", url: "u4", until: 100 },
      { key: "o/r#2", title: "t2", url: "u2", until: 200 },
      { key: "o/r#9", title: null, url: null, until: 300 },
    ]);
  });
});
