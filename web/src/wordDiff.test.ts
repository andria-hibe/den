import { describe, it, expect } from "vitest";
import { markHtml, wordMarks, wordRanges } from "./wordDiff.ts";

describe("wordRanges", () => {
  it("marks only the words that changed", () => {
    const r = wordRanges("const total = sum(a, b);", "const count = sum(a, c);");
    expect(r?.a.map(([s, e]) => "const total = sum(a, b);".slice(s, e))).toEqual(["total", "b"]);
    expect(r?.b.map(([s, e]) => "const count = sum(a, c);".slice(s, e))).toEqual(["count", "c"]);
  });

  it("leaves a rewritten line unmarked", () => {
    expect(wordRanges("return a + b;", "throw new Error('nope here');")).toBeNull();
  });
});

describe("wordMarks and markHtml", () => {
  it("pairs a removed line with the added one after it and marks inside highlight spans", () => {
    const lines = ["@@ -1,2 +1,2 @@", " keep", "-let x = 1;", "+let y = 1;"];
    const marks = wordMarks(lines);
    expect([...marks.keys()]).toEqual([2, 3]);
    const html = '<span class="hljs-keyword">let</span> y = <span class="hljs-number">1</span>;';
    expect(markHtml(html, "let y = 1;", marks.get(3)!)).toBe(
      '<span class="hljs-keyword">let</span> <mark class="diff-word">y</mark> = <span class="hljs-number">1</span>;',
    );
    expect(markHtml(undefined, "a < b", [[0, 1]])).toBe('<mark class="diff-word">a</mark> &lt; b');
  });
});
