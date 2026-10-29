// Whether the plan's weekly limit will last the week (#45). A straight line
// from the window's start: the rate so far, carried forward.

export const WEEK_MS = 7 * 24 * 60 * 60_000;

export interface Pace {
  /** 0-100, as Claude Code reports it. */
  used: number;
  /** 0-100: where an even spend across the week would be by now. */
  expected: number;
  /** "early" until enough of the week has passed for a rate to mean anything. */
  status: "early" | "on-pace" | "ahead";
  /** When the limit runs out at this rate, if that's before the reset. Epoch ms. */
  runsOutAt: number | null;
}

/** Below this share of the week, a few busy hours read as a runaway rate. */
const EARLY = 0.1;
/** Slack before "ahead", in percentage points, so a reading at the line doesn't flap. */
const MARGIN = 3;

/** `usedPercentage` and `resetsAt` are one reading taken at `at`. */
export function weekPace(usedPercentage: number, resetsAt: number, at: number): Pace {
  const elapsed = Math.min(Math.max(at - (resetsAt - WEEK_MS), 0), WEEK_MS);
  const share = elapsed / WEEK_MS;
  const expected = share * 100;
  if (share < EARLY) return { used: usedPercentage, expected, status: "early", runsOutAt: null };
  const status = usedPercentage > expected + MARGIN ? "ahead" : "on-pace";
  let runsOutAt: number | null = null;
  if (usedPercentage >= 100) runsOutAt = at;
  else if (usedPercentage > 0) {
    const at100 = at + ((100 - usedPercentage) / usedPercentage) * elapsed;
    if (at100 < resetsAt) runsOutAt = at100;
  }
  return { used: usedPercentage, expected, status, runsOutAt };
}
