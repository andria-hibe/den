import { describe, it, expect } from "vitest";
import { finishMarker, parseFinish } from "./tabRun.ts";

describe("parseFinish", () => {
  it("reads the printed status, not the echoed command line", () => {
    const echoed = `$ cd /w && ./setup.sh${finishMarker("set up")}\r\n`;
    expect(parseFinish(echoed, "set up")).toBeNull();
    const out = `${echoed}copying .env\r\n\x1b[32mdone\x1b[0m\r\n\r\n[den] set up finished with exit 3\r\n`;
    expect(parseFinish(out, "set up")).toEqual({
      exit: 3,
      before: ["copying .env", "done"],
    });
  });
});
