import { describe, it, expect } from "vitest";
import { deriveFoxPose, foxReasons, isUrgentUnstarted } from "./foxPose.ts";

describe("deriveFoxPose", () => {
  it("alerts when a PR needs me", () => {
    expect(deriveFoxPose({ prNeedsMe: true, prCount: 3, linearNotifs: 0, urgentTickets: 0 })).toBe(
      "alert",
    );
  });

  it("alerts on unread Linear notifications even with healthy PRs", () => {
    expect(deriveFoxPose({ prNeedsMe: false, prCount: 3, linearNotifs: 2, urgentTickets: 0 })).toBe(
      "alert",
    );
  });

  it("is happy when PRs are open but nothing is urgent", () => {
    expect(deriveFoxPose({ prNeedsMe: false, prCount: 2, linearNotifs: 0, urgentTickets: 0 })).toBe(
      "happy",
    );
  });

  it("sits when there is nothing to show", () => {
    expect(deriveFoxPose({ prNeedsMe: false, prCount: 0, linearNotifs: 0, urgentTickets: 0 })).toBe(
      "sit",
    );
  });
});

describe("urgent tickets (#14)", () => {
  const issue = (priority: number, type: string) => ({ priority, state: { type } });

  it("counts an urgent ticket nobody has started", () => {
    for (const type of ["triage", "backlog", "unstarted"]) expect(isUrgentUnstarted(issue(1, type))).toBe(true);
  });

  it("ignores urgent work already under way, and lower priorities", () => {
    expect(isUrgentUnstarted(issue(1, "started"))).toBe(false);
    expect(isUrgentUnstarted(issue(2, "unstarted"))).toBe(false);
    expect(isUrgentUnstarted(issue(0, "backlog"))).toBe(false);
  });

  it("puts the fox on alert even with healthy PRs", () => {
    expect(deriveFoxPose({ prNeedsMe: false, prCount: 3, linearNotifs: 0, urgentTickets: 1 })).toBe("alert");
  });

  it("says which things need you", () => {
    expect(foxReasons({ prNeedsMe: true, prCount: 1, linearNotifs: 2, urgentTickets: 2 })).toEqual([
      "a PR needs you",
      "2 urgent tickets aren't started",
      "2 unread Linear notifications",
    ]);
    expect(foxReasons({ prNeedsMe: false, prCount: 1, linearNotifs: 0, urgentTickets: 0 })).toEqual([]);
  });
});
