import { describe, it, expect } from "vitest";
import { highlightLines, languageFor, splitHighlighted } from "./highlight.ts";

describe("languageFor", () => {
  it("maps the work repo's file types", () => {
    expect(languageFor("apps/api/src/plugins/auth.ts")).toBe("typescript");
    expect(languageFor("a/Planner.tsx")).toBe("typescript");
    expect(languageFor("app/models/person.rb")).toBe("ruby");
    expect(languageFor("app/views/x.html.erb")).toBe("erb");
    expect(languageFor("Gemfile")).toBe("ruby");
    expect(languageFor("config/x.yml")).toBe("yaml");
  });
  it("leaves unknown types plain", () => {
    expect(languageFor("assets/logo.png")).toBeNull();
    expect(languageFor("LICENSE")).toBeNull();
  });
});

describe("splitHighlighted", () => {
  it("closes spans at a line end and reopens them on the next line", () => {
    expect(splitHighlighted('<span class="c">/* a\nb */</span> x')).toEqual([
      '<span class="c">/* a</span>',
      '<span class="c">b */</span> x',
    ]);
  });
  it("keeps nested spans balanced", () => {
    const lines = splitHighlighted('<span class="a"><span class="b">1\n2</span>3</span>');
    expect(lines).toEqual(['<span class="a"><span class="b">1</span></span>', '<span class="a"><span class="b">2</span>3</span>']);
  });
});

describe("highlightLines", () => {
  it("returns one HTML string per line and carries a block comment across lines", () => {
    const out = highlightLines(["/* start", "   end */", "const x = 1;"], "typescript")!;
    expect(out).toHaveLength(3);
    expect(out[1]).toContain("hljs-comment");
    expect(out[2]).toContain("hljs-keyword");
  });
  it("escapes the source, so it's safe as innerHTML", () => {
    const out = highlightLines(['const s = "<img onerror=x>";'], "typescript")!;
    expect(out[0]).not.toContain("<img");
    expect(out[0]).toContain("&lt;img");
  });
  it("leaves minified or unknown content plain", () => {
    expect(highlightLines(["x".repeat(2000)], "javascript")).toBeNull();
    expect(highlightLines(["a"], null)).toBeNull();
  });
});
