import { Critter } from "./Critter.tsx";
import { formatTokens } from "./format.ts";
import type { PaneContext } from "../../server/limits.ts";

// Where the chip turns peach and pink (the developer's pick, 2026-11-03).
// Absolute, since on a 1M window a percentage stayed calm long after the chat
// was worth starting fresh; the percentages catch a small window first.
export const CONTEXT_FILLING_TOKENS = 200_000;
export const CONTEXT_FULL_TOKENS = 400_000;

export function contextLevel(tokens: number, pct: number): "ok" | "filling" | "full" {
  if (tokens >= CONTEXT_FULL_TOKENS || pct >= 80) return "full";
  if (tokens >= CONTEXT_FILLING_TOKENS || pct >= 60) return "filling";
  return "ok";
}

// The field mouse's watch on one pane's context window, beside the header's
// fresh-start button, which is what to reach for when it fills.
export function ContextChip({ context, canFresh }: { context: PaneContext; canFresh: boolean }) {
  const pct = Math.round(context.usedPercentage);
  const level = contextLevel(context.tokens, pct);
  const lines = [
    `Context: ${formatTokens(context.tokens)} of ${formatTokens(context.windowSize)} tokens (${pct}%), as of the last reply.`,
    `Peach from ${formatTokens(CONTEXT_FILLING_TOKENS)}, pink from ${formatTokens(CONTEXT_FULL_TOKENS)}. Near the limit Claude Code compacts the chat, which drops detail.`,
  ];
  if (canFresh) lines.push("✦ starts a fresh chat from the handover instead.");
  return (
    <span className={`ledger-chip context-chip ${level}`} title={lines.join("\n")}>
      <Critter kind="mouse" size={19} className="ledger-mouse" />
      {formatTokens(context.tokens)}
      <span className="ledger-bar" aria-hidden>
        <span className="ledger-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
      </span>
    </span>
  );
}
