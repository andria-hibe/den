import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { formatTokens, formatUSD, relTimeAgo } from "./format.ts";
import type { Usage } from "../../server/usage.ts";
import type { LimitWindow, PlanLimits } from "../../server/limits.ts";

interface SessionSpend {
  conversation: Usage;
  handovers: Usage;
  total: Usage;
  limits: PlanLimits | null;
}

const tokens = (u: Usage) => u.input + u.output + u.cacheRead + u.cacheWrite;

function limitLine(label: string, w: LimitWindow | null, week: boolean): string | null {
  if (!w) return null;
  // A window that has reset since the last reading has used nothing yet.
  if (w.resetsAt <= Date.now()) return `${label}: reset since the last reading.`;
  const when = new Date(w.resetsAt).toLocaleString(undefined, {
    ...(week ? { weekday: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });
  return `${label}: ${Math.round(w.usedPercentage)}% used, resets ${when}.`;
}

// What this Claude pane has used (#11): tokens on the chip; on hover, the cost
// at API prices and the plan's session and week limits. Refreshed every 30s
// while the pane is on screen; hidden until there's something to show.
export function SpendChip({ sessionId }: { sessionId: string }) {
  const [spend, setSpend] = useState<SessionSpend | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      api<SessionSpend>(`/api/sessions/${sessionId}/usage`)
        .then((d) => !stop && setSpend(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [sessionId]);

  if (!spend || tokens(spend.total) <= 0) return null;
  const { handovers: h, total, limits } = spend;
  const lines = [
    `${formatTokens(tokens(total))} tokens: ${formatTokens(total.output)} output, ${formatTokens(total.input + total.cacheWrite)} input, ${formatTokens(total.cacheRead)} read from cache.`,
    `About ${formatUSD(total.costUSD)} at API prices${total.unpriced ? " (plus a model den has no price for)" : ""}.`,
  ];
  if (h.costUSD > 0) lines.push(`Idle handovers: ${formatUSD(h.costUSD)} of that.`);
  if (limits) {
    lines.push("");
    const session = limitLine("Current session", limits.session, false);
    const week = limitLine("Current week", limits.week, true);
    if (session) lines.push(session);
    if (week) lines.push(week);
    lines.push(`Plan limits as of ${relTimeAgo(limits.at)}, from any den pane.`);
  } else {
    lines.push("", "Plan limits show once a den pane has had a reply.");
  }
  return (
    <span className="spend-chip" title={lines.join("\n")}>
      🪙 {formatTokens(tokens(total))}
    </span>
  );
}
