import { describe, it, expect } from "vitest";
import { deriveFoxPose } from "./foxPose.ts";

describe("deriveFoxPose", () => {
  it("alerts when a PR needs me", () => {
    expect(deriveFoxPose({ prNeedsMe: true, prCount: 3, linearNotifs: 0 })).toBe(
      "alert",
    );
  });

  it("alerts on unread Linear notifications even with healthy PRs", () => {
    expect(deriveFoxPose({ prNeedsMe: false, prCount: 3, linearNotifs: 2 })).toBe(
      "alert",
    );
  });

  it("is happy when PRs are open but nothing is urgent", () => {
    expect(deriveFoxPose({ prNeedsMe: false, prCount: 2, linearNotifs: 0 })).toBe(
      "happy",
    );
  });

  it("sits when there is nothing to show", () => {
    expect(deriveFoxPose({ prNeedsMe: false, prCount: 0, linearNotifs: 0 })).toBe(
      "sit",
    );
  });
});
