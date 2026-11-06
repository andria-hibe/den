import { describe, it, expect } from "vitest";
import { pickCleanupSkill } from "./cleanup.ts";

describe("pickCleanupSkill", () => {
  it("finds the one installed *-cleanup skill", () => {
    expect(pickCleanupSkill([null, null], ["readable", "team-cleanup", "synced"])).toBe("team-cleanup");
  });

  it("prefers the configured skill, when it's installed", () => {
    expect(pickCleanupSkill(["tidy-up", null], ["tidy-up", "team-cleanup"])).toBe("tidy-up");
    expect(pickCleanupSkill(["not-installed", null], ["team-cleanup"])).toBe("team-cleanup");
  });

  it("gives no answer rather than guessing between two", () => {
    expect(pickCleanupSkill([null], ["a-cleanup", "b-cleanup"])).toBeNull();
    expect(pickCleanupSkill([null], ["readable"])).toBeNull();
  });

  it("ignores a name that isn't a skill name", () => {
    expect(pickCleanupSkill(["../evil"], ["../evil", "team-cleanup"])).toBe("team-cleanup");
  });
});
