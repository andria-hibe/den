import { describe, expect, it } from "vitest";
import { toggleTodayItem } from "./manager.ts";

describe("toggleTodayItem", () => {
  it("ticks and unticks the nth item, counting ticked ones too", () => {
    const md = "# Today\n\n## Decide\n- [ ] one\n- [x] two\n  detail\n- [ ] three\n";
    expect(toggleTodayItem(md, 2)).toBe("# Today\n\n## Decide\n- [ ] one\n- [x] two\n  detail\n- [x] three\n");
    expect(toggleTodayItem(md, 1)).toBe("# Today\n\n## Decide\n- [ ] one\n- [ ] two\n  detail\n- [ ] three\n");
    expect(toggleTodayItem(md, 3)).toBeNull();
  });
});
