import { describe, it, expect } from "vitest";
import { sinceLastReview } from "./interdiff.ts";

const file = (path: string, hunks: string[]) =>
  `diff --git a/${path} b/${path}\nindex 1..2 100644\n--- a/${path}\n+++ b/${path}\n${hunks.join("")}`;

describe("sinceLastReview", () => {
  const a1 = "@@ -1,2 +1,2 @@\n ctx\n-old\n+new\n";
  const a2 = "@@ -10,1 +10,2 @@\n keep\n+added\n";

  it("keeps only new or changed hunks, ignoring where they moved", () => {
    const prev = file("a.ts", [a1]) + file("gone.ts", [a2]);
    const moved = a1.replace("@@ -1,2 +1,2 @@", "@@ -5,2 +5,2 @@");
    const next = file("a.ts", [moved, a2]) + file("b.ts", [a1]);
    const r = sinceLastReview(prev, next);
    expect(r.changed).toEqual(["a.ts", "b.ts"]);
    expect(r.dropped).toEqual(["gone.ts"]);
    expect(r.diff).toContain("+added");
    expect(r.diff).not.toContain("-old\n+new\n@@ -10");
    expect(r.diff.match(/^@@ /gm)).toHaveLength(2);
  });

  it("sees a binary file that changed again, by its index line", () => {
    const bin = (sha: string) => `diff --git a/b.png b/b.png\nindex ${sha} 100644\nBinary files a/b.png and b/b.png differ\n`;
    expect(sinceLastReview(bin("1..2"), bin("1..3")).changed).toEqual(["b.png"]);
    expect(sinceLastReview(bin("1..2"), bin("1..2")).changed).toEqual([]);
  });

  it("says nothing changed when the diff is the same", () => {
    const d = file("a.ts", [a1]);
    expect(sinceLastReview(d, d)).toEqual({ diff: "", changed: [], dropped: [] });
  });
});
