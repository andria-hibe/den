import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { formatTokens, formatUSD } from "./format.ts";
import type { Usage } from "../../server/usage.ts";

interface SessionSpend {
  conversation: Usage;
  handovers: Usage;
  total: Usage;
}

// What this Claude pane has spent, at API prices (#11): the conversation from
// its transcript, plus den's idle handovers for it. Refreshed every 30s while
// the pane is on screen; hidden until there's something to show.
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

  if (!spend || spend.total.costUSD <= 0) return null;
  const { conversation: c, handovers: h, total } = spend;
  const lines = [
    `About ${formatUSD(total.costUSD)} at API prices${total.unpriced ? " (plus a model den has no price for)" : ""}.`,
    `Conversation: ${formatUSD(c.costUSD)}. ${formatTokens(c.output)} output, ${formatTokens(c.input + c.cacheWrite)} input, ${formatTokens(c.cacheRead)} read from cache.`,
  ];
  if (h.costUSD > 0) lines.push(`Idle handovers: ${formatUSD(h.costUSD)}.`);
  return (
    <span className="spend-chip" title={lines.join("\n")}>
      🪙 {formatUSD(total.costUSD)}
    </span>
  );
}
