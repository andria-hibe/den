import { describe, it, expect } from "vitest";
import { finishMarker, finishReport, parseFinish, takenPorts } from "./tabRun.ts";
import { isAscii } from "../shared/ascii.ts";

describe("set up failures", () => {
  it("finds the taken port and asks the pane to fix it", () => {
    const lines = [
      "Error response from daemon: failed to set up container networking: driver failed programming " +
        "external connectivity on endpoint x-edge-1 (0419): Bind for 127.0.0.1:16686 failed: port is already allocated",
      "Error: listen EADDRINUSE: address already in use :::5173",
    ];
    expect(takenPorts(lines)).toEqual([16686, 5173]);
    const report = finishReport({
      what: "the worktree set up", command: "./setup.sh && runn up", dir: "/w", exit: 1, tail: lines,
      taken: [{ port: 16686, holder: "the container y-edge-1 (compose project y)" }],
      portsFile: ".runn/project.env",
    });
    expect(report).toContain("Port 16686 was already taken, by the container y-edge-1");
    expect(report).toContain("Diagnose and fix this now");
    expect(isAscii(report)).toBe(true);
    const ok = finishReport({ what: "the app", command: "runn up", dir: "/w", exit: 0, tail: [], taken: [] });
    expect(ok).not.toContain("Diagnose");
  });
});

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
