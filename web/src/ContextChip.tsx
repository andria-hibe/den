import { Critter } from "./Critter.tsx";
import { formatTokens } from "./format.ts";
import type { PaneContext } from "../../server/limits.ts";

/** "filling" from 60% and "full" from 80% of the window. */
export function contextLevel(pct: number): "ok" | "filling" | "full" {
  return pct >= 80 ? "full" : pct >= 60 ? "filling" : "ok";
}

// The field mouse's watch on one pane's context window, beside the header's
// fresh-start button, which is what to reach for when it fills.
export function ContextChip({ context, canFresh }: { context: PaneContext; canFresh: boolean }) {
  const pct = Math.round(context.usedPercentage);
  const level = contextLevel(pct);
  const lines = [
    `Context: ${formatTokens(context.tokens)} of ${formatTokens(context.windowSize)} tokens (${pct}%), as of the last reply.`,
    "Near the limit Claude Code compacts the chat, which drops detail.",
  ];
  if (canFresh) lines.push("✦ starts a fresh chat from the handover instead.");
  return (
    <span className={`ledger-chip context-chip ${level}`} title={lines.join("\n")}>
      <Critter kind="mouse" size={19} className="ledger-mouse" />
      {pct}%
      <span className="ledger-bar" aria-hidden>
        <span className="ledger-fill" style={{ width: `${Math.min(pct, 100)}%` }} />
      </span>
    </span>
  );
}
