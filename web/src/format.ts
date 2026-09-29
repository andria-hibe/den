import type { CSSProperties } from "react";
import type { PullRequest } from "../../server/github.ts";

// Display helpers, one copy each so the variants can't drift.

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

/** Tints a work-panel card with the colour of its open session. */
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

/** A dollar estimate for the spend chip: cents under $100, whole dollars above. */
export function formatUSD(usd: number): string {
  if (usd <= 0) return "$0";
  if (usd < 0.01) return "<$0.01";
  if (usd < 100) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd).toLocaleString("en-US")}`;
}

/** A token count at a glance: 950, 4.2k, 12k, 51.7M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}
