import type { FoxPose } from "./foxSprites.ts";

/** Linear state types that mean nobody has picked the ticket up yet. */
const NOT_STARTED = new Set(["triage", "backlog", "unstarted"]);

/** Is an assigned ticket news? Urgent and not started (#14). Priority alone
 * is noisy: an urgent ticket you're already working on isn't news, and a
 * high-priority one can wait for you to get to it. */
export function isUrgentUnstarted(issue: { priority: number; state: { type: string } }): boolean {
  return issue.priority === 1 && NOT_STARTED.has(issue.state.type);
}

export interface FoxInput {
  prNeedsMe: boolean;
  prCount: number;
  linearNotifs: number;
  /** Assigned tickets that are urgent and not started. */
  urgentTickets: number;
}

// The topbar fox's pose, derived rather than set inline so every attention
// source counts. `sleep` and `walk` are for the empty state and loading rows.
export function deriveFoxPose(input: FoxInput): FoxPose {
  if (foxReasons(input).length > 0) return "alert";
  if (input.prCount > 0) return "happy";
  return "sit";
}

/** Why the fox is on alert, for its tooltip. Empty when it isn't. */
export function foxReasons(input: FoxInput): string[] {
  const out: string[] = [];
  if (input.prNeedsMe) out.push("a PR needs you");
  if (input.urgentTickets > 0) {
    out.push(
      input.urgentTickets === 1
        ? "an urgent ticket isn't started"
        : `${input.urgentTickets} urgent tickets aren't started`,
    );
  }
  if (input.linearNotifs > 0) {
    out.push(`${input.linearNotifs} unread Linear notification${input.linearNotifs === 1 ? "" : "s"}`);
  }
  return out;
}

// The full cast, for the click-to-open status popover.
export const FOX_POSES: { pose: FoxPose; label: string; note: string }[] = [
  { pose: "sit", label: "Sit", note: "idle — open PRs, nothing urgent" },
  { pose: "happy", label: "Happy", note: "all your PRs look healthy" },
  { pose: "alert", label: "Alert", note: "a PR, a review, an urgent ticket, or Linear needs you" },
  { pose: "walk", label: "Walk", note: "busy — shown while loading" },
  { pose: "sleep", label: "Sleep", note: "empty — the den is quiet" },
];

export const STATUS_TITLE: Record<FoxPose, string> = {
  happy: "all your PRs look happy 🎉",
  alert:
    "something needs you — a PR to fix, a review you owe, an urgent ticket nobody has started, or Linear notifications",
  sit: "no open PRs right now",
  sleep: "",
  walk: "",
};
