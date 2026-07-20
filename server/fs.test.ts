import { describe, it, expect, afterAll } from "vitest";
import { homedir } from "node:os";
import { join } from "node:path";
import { symlinkSync, rmSync, mkdirSync } from "node:fs";
import { within, soleGitRepo } from "./fs.ts";

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

describe("soleGitRepo (work-dir auto-detect)", () => {
  const base = join(HOME, `.den-worktest-${process.pid}`);
  const mk = (...parts: string[]) => {
    const p = join(base, ...parts);
    mkdirSync(p, { recursive: true });
    return p;
  };
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  it("returns null when the dir doesn't exist", () => {
    expect(soleGitRepo(join(base, "nope"))).toBe(null);
  });

  it("returns null when there are no git repos", () => {
    const dir = mk("empty");
    mkdirSync(join(dir, "plain-folder"), { recursive: true });
    expect(soleGitRepo(dir)).toBe(null);
  });

  it("returns the sole repo when exactly one child has .git", () => {
    const dir = mk("one");
    const repo = join(dir, "myrepo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(dir, "not-a-repo"), { recursive: true });
    expect(soleGitRepo(dir)).toBe(repo);
  });

  it("returns null when more than one child is a repo (ambiguous)", () => {
    const dir = mk("many");
    mkdirSync(join(dir, "a", ".git"), { recursive: true });
    mkdirSync(join(dir, "b", ".git"), { recursive: true });
    expect(soleGitRepo(dir)).toBe(null);
  });
});
