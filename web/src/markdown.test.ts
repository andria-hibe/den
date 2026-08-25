import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown.ts";

describe("renderMarkdown", () => {
  it("escapes HTML before anything else", () => {
    expect(renderMarkdown("<img onerror=x>")).toBe("<p>&lt;img onerror=x&gt;</p>");
  });

  it("joins a hard-wrapped paragraph into one <p>", () => {
    expect(renderMarkdown("Sorts the queue by due time,\ninstead of the head.")).toBe(
      "<p>Sorts the queue by due time, instead of the head.</p>",
    );
  });

  it("keeps a wrapped bullet inside its list item", () => {
    expect(renderMarkdown("- app.ts:14 - `sort` mutates the queue,\n  so sort a copy.")).toBe(
      "<ul><li>app.ts:14 - <code>sort</code> mutates the queue, so sort a copy.</li></ul>",
    );
  });

  it("still splits on a blank line", () => {
    expect(renderMarkdown("one\n\ntwo")).toBe("<p>one</p><p>two</p>");
  });

  it("does not swallow a numbered list into the paragraph above", () => {
    expect(renderMarkdown("Steps:\n1. first\n2. second")).toBe(
      "<p>Steps:</p><p>1. first</p><p>2. second</p>",
    );
  });

  it("closes the list when prose follows a blank line", () => {
    expect(renderMarkdown("- a\n- b\n\ndone")).toBe(
      "<ul><li>a</li><li>b</li></ul><p>done</p>",
    );
  });

  it("keeps headings, rules and fenced code verbatim", () => {
    expect(renderMarkdown("## Title\ntext")).toBe("<h2>Title</h2><p>text</p>");
    expect(renderMarkdown("---")).toBe("<hr>");
    expect(renderMarkdown("```\na\nb\n```")).toBe("<pre>a\nb\n</pre>");
  });

  it("renders inline code, emphasis and links", () => {
    expect(renderMarkdown("**b** *i* `c` [x](https://e.com)")).toBe(
      '<p><strong>b</strong> <em>i</em> <code>c</code> ' +
        '<a href="https://e.com" target="_blank" rel="noreferrer">x</a></p>',
    );
  });
});
