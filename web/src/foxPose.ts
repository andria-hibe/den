import type { FoxPose } from "./foxSprites.ts";

// The topbar status fox's pose is derived from every attention source — never
// set inline. `alert` when something needs *your* action: a PR needing you
// (authored PR failing CI / changes requested, or a review you owe) OR unread
// Linear notifications. Else `happy` when any PRs are open, else `sit`.
// (`sleep`/`walk` are used elsewhere — empty state and loading rows — not here.)
export function deriveFoxPose(input: {
  prNeedsMe: boolean;
  prCount: number;
  linearNotifs: number;
}): FoxPose {
  if (input.prNeedsMe || input.linearNotifs > 0) return "alert";
  if (input.prCount > 0) return "happy";
  return "sit";
}

// The full cast, for the click-to-open status popover.
export const FOX_POSES: { pose: FoxPose; label: string; note: string }[] = [
  { pose: "sit", label: "Sit", note: "idle — open PRs, nothing urgent" },
  { pose: "happy", label: "Happy", note: "all your PRs look healthy" },
  { pose: "alert", label: "Alert", note: "a PR, a review, or Linear needs you" },
  { pose: "walk", label: "Walk", note: "busy — shown while loading" },
  { pose: "sleep", label: "Sleep", note: "empty — the den is quiet" },
];

export const STATUS_TITLE: Record<FoxPose, string> = {
  happy: "all your PRs look happy 🎉",
  alert:
    "something needs you — a PR to fix, a review you owe, or Linear notifications",
  sit: "no open PRs right now",
  sleep: "",
  walk: "",
};
