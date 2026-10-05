import { describe, it, expect } from "vitest";
import { parseLimits, statusLineSettings } from "./limits.ts";

describe("parseLimits", () => {
  it("reads both windows, and nothing before the pane's first reply", () => {
    const json = JSON.stringify({
      rate_limits: {
        five_hour: { used_percentage: 5, resets_at: 1790671200 },
        seven_day: { used_percentage: 4, resets_at: 1791201600 },
      },
    });
    expect(parseLimits(json, 1)).toEqual({
      session: { usedPercentage: 5, resetsAt: 1790671200000 },
      week: { usedPercentage: 4, resetsAt: 1791201600000 },
      at: 1,
    });
    expect(parseLimits(JSON.stringify({ session_id: "x" }), 1)).toBeNull();
  });
});

describe("statusLineSettings", () => {
  it("hands the saved input to the developer's own status line", () => {
    const { statusLine } = statusLineSettings("g1", { command: "jq -r .model | cut -c1-9", padding: 2 });
    expect(statusLine.command).toMatch(/&& mv '[^']*g1\.json\.tmp' '[^']*g1\.json' && \(jq -r \.model \| cut -c1-9\) < '[^']*g1\.json'$/);
    expect(statusLine.padding).toBe(2);
  });
});
