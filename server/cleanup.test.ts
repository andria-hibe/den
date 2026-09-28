import { describe, it, expect } from "vitest";
import { pickCleanupSkill } from "./cleanup.ts";

describe("pickCleanupSkill", () => {
  it("finds the one installed *-cleanup skill", () => {
    expect(pickCleanupSkill([null, null], ["readable", "runn-cleanup", "synced"])).toBe("runn-cleanup");
  });

  it("prefers the configured skill, when it's installed", () => {
    expect(pickCleanupSkill(["tidy-up", null], ["tidy-up", "runn-cleanup"])).toBe("tidy-up");
    expect(pickCleanupSkill(["not-installed", null], ["runn-cleanup"])).toBe("runn-cleanup");
  });

  it("gives no answer rather than guessing between two", () => {
    expect(pickCleanupSkill([null], ["a-cleanup", "b-cleanup"])).toBeNull();
    expect(pickCleanupSkill([null], ["readable"])).toBeNull();
  });

  it("ignores a name that isn't a skill name", () => {
    expect(pickCleanupSkill(["../evil"], ["../evil", "runn-cleanup"])).toBe("runn-cleanup");
  });
});
