import { describe, it, expect, vi } from "vitest";
import { chooseResume } from "./sessions.ts";

const PINNED = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("chooseResume", () => {
  it("resumes the pane's own conversation when its transcript exists", () => {
    expect(chooseResume(PINNED, () => true, () => OTHER)).toEqual({ resume: true, id: PINNED });
  });

  it("starts fresh under the pinned id when the transcript is missing, never borrowing another (#25)", () => {
    const latest = vi.fn(() => OTHER);
    expect(chooseResume(PINNED, () => false, latest)).toEqual({ resume: false, id: PINNED });
    expect(latest).not.toHaveBeenCalled();
  });

  it("falls back to the newest conversation in the folder only for a row with no pinned id", () => {
    expect(chooseResume(null, () => false, () => OTHER)).toEqual({ resume: true, id: OTHER });
  });

  it("starts fresh under a new id when there is nothing to resume", () => {
    const pick = chooseResume(null, () => false, () => null);
    expect(pick.resume).toBe(false);
    expect(pick.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
