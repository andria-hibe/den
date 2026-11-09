import { describe, expect, it } from "vitest";
import { setTodayItem, todayItems } from "../../server/manager.ts";
import { renderMarkdown } from "./markdown.ts";
import { nextTodayState, tickBoxes, todayMarkdown } from "./TodayView.tsx";

describe("Today ticks", () => {
  it("numbers the boxes the way setTodayItem counts items, ignoring box glyphs in the text", () => {
    const md = "# Today\n## Decide\n- [x] done one\n- [ ] open two, where ☑ means done\n## FYI\n- [-] skipped three\n";
    const html = tickBoxes(renderMarkdown(todayMarkdown(md)));
    const items = [...html.matchAll(/data-item="(\d+)"[^>]*>[^<]*<\/button> ([^<]+)/g)].map((m) => [Number(m[1]), m[2]]);
    expect(items).toEqual([[0, "done one"], [1, "open two, where ☑ means done"], [2, "skipped three"]]);
    expect(todayItems(md)[2]).toEqual({ text: "skipped three", state: "wontdo" });
    expect(setTodayItem(md, 2, "open", "skipped three")).toContain("- [ ] skipped three");
  });

  it("ticks on a click and crosses out on a double-click, each undoing itself", () => {
    expect([nextTodayState("open", 1), nextTodayState("done", 1), nextTodayState("wontdo", 1)]).toEqual(["done", "open", "open"]);
    expect([nextTodayState("open", 2), nextTodayState("done", 2), nextTodayState("wontdo", 2)]).toEqual(["wontdo", "wontdo", "open"]);
  });

  it("refuses an index whose item has changed since the view showed it", () => {
    const rewritten = "# Today\n- [ ] a new first item\n- [ ] open three\n";
    expect(setTodayItem(rewritten, 0, "done", "open three")).toBeNull();
  });
});
