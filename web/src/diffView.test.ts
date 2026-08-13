import { describe, it, expect } from "vitest";
import { classify, diffFiles, lineNumbers } from "./DiffView.tsx";

const DIFF = [
  "diff --git a/server/git.ts b/server/git.ts",
  "index 1111111..2222222 100644",
  "--- a/server/git.ts",
  "+++ b/server/git.ts",
  "@@ -10,4 +10,5 @@ export function prepareWork() {",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " return a;",
  "@@ -40,2 +41,2 @@",
  " tail;",
  "-gone;",
  "\\ No newline at end of file",
].join("\n");

/** [old, new] pairs, `null` where the line has no number on that side. */
const pairs = (lines: string[]) => lineNumbers(lines).map((n) => [n.old, n.new]);

describe("lineNumbers", () => {
  it("numbers each side from the hunk header", () => {
    expect(pairs(DIFF.split("\n"))).toEqual([
      [null, null], // diff --git
      [null, null], // index
      [null, null], // ---
      [null, null], // +++
      [null, null], // @@
      [10, 10], // context
      [11, null], // removed
      [null, 11], // added
      [null, 12], // added
      [12, 13], // context
      [null, null], // @@
      [40, 41], // context
      [41, null], // removed
      [null, null], // \ No newline
    ]);
  });

  it("does not number the preamble, whose --- / +++ lines look like changes", () => {
    const [file, index, minus, plus] = lineNumbers(DIFF.split("\n"));
    for (const n of [file, index, minus, plus]) expect(n).toEqual({ old: null, new: null });
  });

  it("restarts counting at each file", () => {
    const two = [
      "diff --git a/a.ts b/a.ts",
      "@@ -1,1 +1,1 @@",
      "+one",
      "diff --git a/b.ts b/b.ts",
      "index 3333333..4444444 100644",
      "+++ b/b.ts",
      "@@ -7,1 +9,1 @@",
      "+nine",
    ].join("\n");
    expect(pairs(two.split("\n"))).toEqual([
      [null, null],
      [null, null],
      [null, 1],
      [null, null],
      [null, null],
      [null, null],
      [null, null],
      [null, 9],
    ]);
  });

  it("numbers a bare GitHub review hunk (starts at its @@ header)", () => {
    const hunk = ["@@ -100,3 +104,4 @@ const x = 1;", " keep;", "+added;", " keep2;"];
    expect(pairs(hunk)).toEqual([
      [null, null],
      [100, 104],
      [null, 105],
      [101, 106],
    ]);
  });
});

describe("classify", () => {
  it("labels the line kinds the gutter is coloured from", () => {
    expect(classify("diff --git a/x b/x")).toBe("diff-file");
    expect(classify("@@ -1 +1 @@")).toBe("diff-hunk");
    expect(classify("+add")).toBe("diff-add");
    expect(classify("-del")).toBe("diff-del");
    expect(classify(" ctx")).toBe("diff-ctx");
  });
});

describe("diffFiles", () => {
  it("lists the paths a diff touches", () => {
    expect(diffFiles(DIFF)).toEqual(["server/git.ts"]);
  });
});
