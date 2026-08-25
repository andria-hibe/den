import type { CSSProperties } from "react";
import type { PullRequest } from "../../server/github.ts";

// Small display helpers shared across the work panels, dialogs, and comment
// views — one copy each, so the variants can't drift.

/** Compact age for a card corner: "5m", "3h", "2d". */
export function relTime(time: string | number): string {
  const at = typeof time === "number" ? time : new Date(time).getTime();
  const m = Math.round((Date.now() - at) / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** Prose age for a list row: "just now", "5m ago", "3h ago". */
export function relTimeAgo(time: string | number): string {
  const at = typeof time === "number" ? time : new Date(time).getTime();
  if (Date.now() - at < 60000) return "just now";
  return `${relTime(time)} ago`;
}

/** A work-panel card linked to an open session is tinted with that session's
 * colour (left stripe + faint wash) so related work reads at a glance. */
export function accentStyle(color?: string): CSSProperties | undefined {
  if (!color) return undefined;
  return {
    borderLeftColor: color,
    borderLeftWidth: 5,
    background: `color-mix(in srgb, ${color} 16%, var(--bg-rail))`,
  };
}

/** Stable identity for a PR across polls (repo + number). */
export const prKey = (p: PullRequest) => `${p.repo}#${p.number}`;
