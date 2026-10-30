import { describe, expect, it } from "vitest";
import { todayItemTexts, toggleTodayItem } from "../../server/manager.ts";
import { renderMarkdown } from "./markdown.ts";
import { tickBoxes, todayMarkdown } from "./TodayView.tsx";

describe("Today ticks", () => {
  it("numbers the boxes the way toggleTodayItem counts items, ignoring box glyphs in the text", () => {
    const md = "# Today\n## Decide\n- [x] done one\n- [ ] open two, where ☑ means done\n## FYI\n- [ ] open three\n";
    const html = tickBoxes(renderMarkdown(todayMarkdown(md)));
    const items = [...html.matchAll(/data-item="(\d+)"[^>]*>[^<]*<\/button> ([^<]+)/g)].map((m) => [Number(m[1]), m[2]]);
    expect(items).toEqual([[0, "done one"], [1, "open two, where ☑ means done"], [2, "open three"]]);
    expect(todayItemTexts(md)[2]).toBe("open three");
    expect(toggleTodayItem(md, 2, "open three")).toContain("- [x] open three");
  });

  it("refuses an index whose item has changed since the view showed it", () => {
    const rewritten = "# Today\n- [ ] a new first item\n- [ ] open three\n";
    expect(toggleTodayItem(rewritten, 0, "open three")).toBeNull();
  });
});
