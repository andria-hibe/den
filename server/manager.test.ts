import { describe, expect, it } from "vitest";
import { setTodayItem, todayIsOld, waitingChangeMessage } from "./manager.ts";

describe("setTodayItem", () => {
  it("sets the nth item's box, counting done and won't-do items too", () => {
    const md = "# Today\n\n## Decide\n- [ ] one\n- [x] two\n  detail\n- [-] three\n- [ ] four\n";
    expect(setTodayItem(md, 3, "wontdo")).toBe("# Today\n\n## Decide\n- [ ] one\n- [x] two\n  detail\n- [-] three\n- [-] four\n");
    expect(setTodayItem(md, 2, "open")).toBe("# Today\n\n## Decide\n- [ ] one\n- [x] two\n  detail\n- [ ] three\n- [ ] four\n");
    expect(setTodayItem(md, 0, "done")).toContain("- [x] one");
    expect(setTodayItem(md, 4, "done")).toBeNull();
  });
});

describe("todayIsOld", () => {
  it("is old only when the heading names another day", () => {
    const now = new Date(2026, 10, 7, 9, 0);
    expect(todayIsOld("# Today, Friday 6 November\n## Decide\n", now)).toBe(true);
    expect(todayIsOld("# Today, Saturday 7 November\n## Decide\n", now)).toBe(false);
    expect(todayIsOld("# Today, Saturday, 7th November\n", now)).toBe(false);
    expect(todayIsOld("", now)).toBe(false);
  });
});

describe("waitingChangeMessage", () => {
  it("names what the session settled and what it added, and stays quiet otherwise", () => {
    const msg = waitingChangeMessage("FAST-1: thing", ["Pick A or B", "Approve the plan"], ["Approve the plan", "Merge #12?"]);
    expect(msg).toContain('no longer waiting on the developer: "Pick A or B"');
    expect(msg).toContain('now waiting on the developer: "Merge #12?"');
    expect(waitingChangeMessage("x", ["Pick A or B."], ["pick a  or B"])).toBeNull();
  });
});
