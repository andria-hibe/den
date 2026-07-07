import { describe, it, expect } from "vitest";
import { isValidBranch } from "./git.ts";

describe("isValidBranch", () => {
  it("accepts normal branch names", () => {
    expect(isValidBranch("fast-6115-fix-thing")).toBe(true);
    expect(isValidBranch("andria/fast-6115")).toBe(true);
    expect(isValidBranch("release/1.2.x")).toBe(true);
  });

  it("rejects a leading dash (would be read as a git flag)", () => {
    expect(isValidBranch("--force")).toBe(false);
    expect(isValidBranch("-b")).toBe(false);
  });

  it("rejects shell/path metacharacters", () => {
    expect(isValidBranch("foo;rm -rf ~")).toBe(false);
    expect(isValidBranch("foo bar")).toBe(false);
    expect(isValidBranch("foo$(whoami)")).toBe(false);
    expect(isValidBranch("../escape")).toBe(false);
  });

  it("rejects '..' anywhere (ref traversal)", () => {
    expect(isValidBranch("a..b")).toBe(false);
  });

  it("rejects the empty string", () => {
    expect(isValidBranch("")).toBe(false);
  });
});
