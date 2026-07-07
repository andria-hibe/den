import { describe, it, expect, afterAll } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { symlinkSync, rmSync } from "node:fs";
import { within } from "./fs.ts";

const HOME = homedir();

describe("within (home sandbox)", () => {
  it("accepts HOME and its descendants", () => {
    expect(within(HOME)).toBe(true);
    expect(within(join(HOME, "Documents"))).toBe(true);
  });

  it("rejects paths outside HOME", () => {
    expect(within("/etc")).toBe(false);
    expect(within("/")).toBe(false);
  });

  it("rejects traversal that escapes HOME", () => {
    expect(within(join(HOME, "..", "..", "etc"))).toBe(false);
  });

  it("allows a not-yet-existing path whose parent is under HOME", () => {
    expect(within(join(HOME, "some-dir-that-does-not-exist-xyz"))).toBe(true);
  });

  describe("symlink escape", () => {
    const link = join(HOME, `.den-fs-test-link-${process.pid}`);
    afterAll(() => rmSync(link, { force: true }));

    it("rejects a symlink inside HOME that points outside HOME", () => {
      symlinkSync("/etc", link);
      // String resolution alone would pass (the link's path is under HOME);
      // realpath resolution must catch that its target is not.
      expect(within(link)).toBe(false);
    });
  });
});
