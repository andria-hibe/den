import { describe, expect, it } from "vitest";
import { isAscii } from "../shared/ascii.ts";
import { lineAskInstruction, lineAskPrompt } from "./lineAsk.ts";

describe("line questions", () => {
  it("are plain ASCII", () => {
    expect(isAscii(lineAskInstruction({ pr: 7, diffPath: "/d.diff", guidePath: "/g.md" }))).toBe(true);
    expect(isAscii(lineAskPrompt({ file: "a.ts", side: "new", line: 3, quote: "x()", hunk: "@@ -1 +1 @@\n+x()" }, "why?"))).toBe(true);
  });
});
