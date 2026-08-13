import { describe, it, expect } from "vitest";
import {
  summarizeChecks,
  reviewFrom,
  parseTicketHint,
  authoredAttention,
  reviewAttention,
  isValidRepo,
} from "./github.ts";

describe("summarizeChecks", () => {
  it("reports none when there are no checks", () => {
    expect(summarizeChecks([]).state).toBe("none");
  });

  it("fails if any check's latest run failed", () => {
    const r = summarizeChecks([{ bucket: "pass" }, { bucket: "fail" }]);
    expect(r.state).toBe("failing");
    expect(r.counts).toMatchObject({ passed: 1, failed: 1 });
  });

  it("is pending while a check is still running", () => {
    const r = summarizeChecks([{ bucket: "pass" }, { bucket: "pending" }]);
    expect(r.state).toBe("pending");
  });

  it("counts a fully green PR as passing", () => {
    const r = summarizeChecks([{ bucket: "pass" }, { bucket: "pass" }]);
    expect(r.state).toBe("passing");
    expect(r.counts).toMatchObject({ passed: 2, failed: 0, pending: 0, total: 2 });
  });

  it("ignores skipped and cancelled checks", () => {
    const r = summarizeChecks([
      { bucket: "skipping" },
      { bucket: "cancel" },
      { bucket: "pass" },
    ]);
    expect(r.state).toBe("passing");
    expect(r.counts.total).toBe(1);
  });

  it("ignores an unrecognized bucket rather than inventing a failure", () => {
    const r = summarizeChecks([{ bucket: "pass" }, { bucket: "something-new" }, {}]);
    expect(r.state).toBe("passing");
    expect(r.counts.total).toBe(1);
  });

  // The bug this source change fixes: the old statusCheckRollup kept superseded
  // runs, so a re-run that went green still carried its stale FAILURE row and
  // the PR read as failing forever. gh pr checks gives one row per check.
  it("passes a PR whose failing check was re-run green (deduped input)", () => {
    const r = summarizeChecks([
      { bucket: "pass" }, // "Validate PR title", latest run
      { bucket: "pass" },
      { bucket: "skipping" },
    ]);
    expect(r.state).toBe("passing");
    expect(r.counts.failed).toBe(0);
  });
});

describe("reviewFrom", () => {
  it("maps GitHub review decisions", () => {
    expect(reviewFrom("APPROVED")).toBe("approved");
    expect(reviewFrom("CHANGES_REQUESTED")).toBe("changes_requested");
    expect(reviewFrom("REVIEW_REQUIRED")).toBe("review_required");
    expect(reviewFrom(null)).toBe("none");
    expect(reviewFrom("SOMETHING_ELSE")).toBe("none");
  });
});

describe("parseTicketHint", () => {
  it("pulls fast-NNNN out of a branch name", () => {
    expect(parseTicketHint("jordan-fast-5979-stretch")).toBe("fast-5979");
    expect(parseTicketHint("FAST-6115")).toBe("FAST-6115");
  });
  it("returns undefined without a ticket", () => {
    expect(parseTicketHint("main")).toBeUndefined();
    expect(parseTicketHint(undefined)).toBeUndefined();
  });
});

describe("authoredAttention (your own PRs)", () => {
  it("flags failing checks", () => {
    expect(authoredAttention({ review: "none", checks: "failing" })).toMatchObject({
      needsAttention: true,
    });
  });
  it("flags changes requested", () => {
    const r = authoredAttention({ review: "changes_requested", checks: "passing" });
    expect(r.needsAttention).toBe(true);
    expect(r.attentionReason).toContain("changes requested");
  });
  it("combines both reasons", () => {
    const r = authoredAttention({ review: "changes_requested", checks: "failing" });
    expect(r.attentionReason).toBe("changes requested · checks failing");
  });
  it("stays calm when passing and approved", () => {
    expect(authoredAttention({ review: "approved", checks: "passing" })).toEqual({
      needsAttention: false,
    });
  });
});

describe("isValidRepo (owner/name slug)", () => {
  it("accepts well-formed nameWithOwner slugs", () => {
    expect(isValidRepo("owner/repo")).toBe(true);
    expect(isValidRepo("Runn-Fast/runn")).toBe(true);
    expect(isValidRepo("a.b_c/d.e_f")).toBe(true);
  });
  it("rejects malformed or injection-shaped values", () => {
    expect(isValidRepo("")).toBe(false);
    expect(isValidRepo("noslash")).toBe(false);
    expect(isValidRepo("owner/repo/extra")).toBe(false);
    expect(isValidRepo("-flag/x")).toBe(false); // leading dash can't become a flag
    expect(isValidRepo("owner /repo")).toBe(false); // spaces can't split into args
    expect(isValidRepo("owner/repo;rm -rf")).toBe(false);
    expect(isValidRepo("../../etc/passwd")).toBe(false);
  });
});

describe("reviewAttention (PRs you were asked to review)", () => {
  it("flags a review you owe", () => {
    expect(reviewAttention({ isDraft: false, review: "review_required" })).toMatchObject({
      needsAttention: true,
    });
  });
  it("does NOT flag once you've already approved it", () => {
    expect(reviewAttention({ isDraft: false, review: "approved" })).toEqual({
      needsAttention: false,
    });
  });
  it("does NOT flag drafts", () => {
    expect(reviewAttention({ isDraft: true, review: "review_required" })).toEqual({
      needsAttention: false,
    });
  });
});
