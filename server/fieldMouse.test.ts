import { describe, expect, it } from "vitest";
import { assess, type Reading } from "./fieldMouse.ts";

const MIN = 60_000;
const now = Date.UTC(2026, 10, 6, 3, 0);
const weekResetsAt = now + 4 * 24 * 60 * MIN; // three days into the week
const reading = (minsAgo: number, session: number, week: number): Reading => ({
  at: now - minsAgo * MIN,
  session,
  sessionResetsAt: now + 120 * MIN,
  week,
  weekResetsAt,
});

describe("field mouse", () => {
  it("is quiet when use is steady", () => {
    const w = assess([reading(30, 20, 30), reading(0, 24, 30.5)], now);
    expect(w.level).toBe("ok");
    // A point over an even week (about 42.9% three days in) isn't tight.
    expect(assess([reading(0, 24, 44)], now).level).toBe("ok");
  });

  it("calls a 5-hour window that will run out before it resets tight, and a sudden week jump a watch", () => {
    // 30 points in 20 minutes reaches 100% in about 27 more minutes, well before the reset in 2 hours.
    const w = assess([reading(20, 30, 30), reading(0, 60, 34)], now);
    expect(w.level).toBe("tight");
    expect(w.alerts.map((a) => a.key.split(":")[0]).sort()).toEqual(["session-jump", "session-out", "week-jump"]);
  });
});
