import { describe, it, expect } from "vitest";
import { bulletLine, buildReviewPost, linesInDiff, splitBullets } from "./reviewPost.ts";

const DIFF = [
  "diff --git a/server/git.ts b/server/git.ts",
  "--- a/server/git.ts",
  "+++ b/server/git.ts",
  "@@ -10,3 +10,4 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "+const c = 4;",
  " return a;",
].join("\n");

describe("bulletLine", () => {
  it("reads path:line, a range's end, and 'line N'", () => {
    expect(bulletLine("server/git.ts:11 - drop the cast")).toBe(11);
    expect(bulletLine("`server/git.ts:11-12` - both lines")).toBe(12);
    expect(bulletLine("line 12: rename")).toBe(12);
    expect(bulletLine("L12 rename")).toBe(12);
  });
  it("is null when the bullet names no line", () => {
    expect(bulletLine("Consider a test for the empty case.")).toBeNull();
  });
});

describe("splitBullets", () => {
  it("keeps a bullet's continuation lines with it", () => {
    expect(splitBullets("- a:1 first\n  still first\n- a:2 second")).toEqual(["a:1 first\nstill first", "a:2 second"]);
  });
});

describe("linesInDiff", () => {
  it("lists the new-side lines the hunk covers", () => {
    expect([...linesInDiff(DIFF, "server/git.ts")]).toEqual([10, 11, 12, 13]);
  });
});

describe("buildReviewPost", () => {
  const post = buildReviewPost(
    "Solid change.",
    {
      "server/git.ts": [
        "- server/git.ts:11 - b should stay 2.",
        "- server/git.ts:40 - this line isn't in the diff.",
        "- Add a test for c.",
      ].join("\n"),
    },
    DIFF,
  );

  it("posts bullets on diff lines as inline comments", () => {
    expect(post.comments).toEqual([{ path: "server/git.ts", line: 11, body: "server/git.ts:11 - b should stay 2." }]);
  });

  it("puts the rest in the body under the file's name, after the general review", () => {
    expect(post.body).toBe(
      "Solid change.\n\n**server/git.ts**\n\n- server/git.ts:40 - this line isn't in the diff.\n- Add a test for c.",
    );
  });
});
