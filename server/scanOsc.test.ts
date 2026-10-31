import { describe, expect, it } from "vitest";
import { scanOsc } from "./sessions.ts";

describe("scanOsc", () => {
  it("takes titles and ignores the BEL that ends an OSC, even split across chunks", () => {
    const a = scanOsc("", "hi\x1b]0;◐ Fox\x07 \x1b]8;;https://x\x07link\x1b]8;;\x07 \x1b]0;✳ F");
    expect(a).toMatchObject({ titles: ["◐ Fox"], bell: false });
    const b = scanOsc(a.carry, "ox\x07");
    expect(b).toEqual({ titles: ["✳ Fox"], bell: false, carry: "" });
    expect(scanOsc("", "done\x07").bell).toBe(true);
    expect(scanOsc(scanOsc("", "x\x1b").carry, "]0;a\x07")).toEqual({ titles: ["a"], bell: false, carry: "" });
  });
});
