import { describe, expect, it } from "vitest";
import { WEEK_MS, weekPace } from "../shared/pace.ts";

const DAY = 24 * 60 * 60_000;
const reset = 10 * WEEK_MS;
const day = (n: number) => reset - WEEK_MS + n * DAY;

describe("weekPace", () => {
  it("is on pace when spend tracks the week", () => {
    expect(weekPace(40, reset, day(3))).toMatchObject({ status: "on-pace", runsOutAt: null });
  });

  it("says when the limit runs out at the rate so far", () => {
    // 60% in 3 days is 20% a day: the last 40% lasts 2 more days.
    const p = weekPace(60, reset, day(3));
    expect(p.status).toBe("ahead");
    expect(p.runsOutAt).toBe(day(5));
  });

  it("doesn't judge the first hours of a week", () => {
    expect(weekPace(8, reset, day(0.25)).status).toBe("early");
  });
});
