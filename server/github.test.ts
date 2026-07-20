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

  it("fails if any CheckRun concluded in failure", () => {
    const r = summarizeChecks([
      { status: "COMPLETED", conclusion: "SUCCESS" },
      { status: "COMPLETED", conclusion: "FAILURE" },
    ]);
    expect(r.state).toBe("failing");
    expect(r.counts).toMatchObject({ passed: 1, failed: 1 });
  });

  it("is pending while a CheckRun is still running", () => {
    const r = summarizeChecks([
      { status: "COMPLETED", conclusion: "SUCCESS" },
      { status: "IN_PROGRESS" },
    ]);
    expect(r.state).toBe("pending");
  });

  it("ignores neutral/skipped conclusions", () => {
    const r = summarizeChecks([
      { status: "COMPLETED", conclusion: "SKIPPED" },
      { status: "COMPLETED", conclusion: "SUCCESS" },
    ]);
    expect(r.state).toBe("passing");
    expect(r.counts.total).toBe(1);
  });

  it("handles legacy StatusContext rows (state field)", () => {
    expect(summarizeChecks([{ state: "FAILURE" }]).state).toBe("failing");
    expect(summarizeChecks([{ state: "SUCCESS" }]).state).toBe("passing");
    expect(summarizeChecks([{ state: "PENDING" }]).state).toBe("pending");
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
