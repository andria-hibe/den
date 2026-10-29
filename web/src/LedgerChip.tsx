import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { formatTokens, relTimeAgo } from "./format.ts";
import { weekPace } from "../../shared/pace.ts";
import { Critter } from "./Critter.tsx";
import type { PlanLimits } from "../../server/limits.ts";

interface Overview {
  limits: PlanLimits | null;
  panes: { id: string; name: string; context: number }[];
}

const when = (ms: number, weekday: boolean) =>
  new Date(ms).toLocaleString(undefined, {
    ...(weekday ? { weekday: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  });

const LABEL = { early: "early in the week", "on-pace": "on pace", ahead: "ahead" } as const;

// The week's token pace (#45): the week's use against an even spend, and on
// hover the 5-hour window and the chats that cost the most per turn. Hidden
// until a pane has reported the plan's limits.
export function LedgerChip({ squirrel = false }: { squirrel?: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  useEffect(() => {
    let stop = false;
    const load = () =>
      api<Overview>("/api/usage")
        .then((d) => !stop && setData(d))
        .catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const week = data?.limits?.week;
  if (!data?.limits || !week || week.resetsAt <= Date.now()) return null;
  const pace = weekPace(week.usedPercentage, week.resetsAt, data.limits.at);
  const lines = [
    `This week: ${Math.round(pace.used)}% used; an even pace would be ${Math.round(pace.expected)}%. Resets ${when(week.resetsAt, true)}.`,
  ];
  if (pace.runsOutAt) lines.push(`At this week's rate it runs out ${when(pace.runsOutAt, true)}.`);
  const session = data.limits.session;
  if (session && session.resetsAt > Date.now()) {
    lines.push(`This 5-hour window: ${Math.round(session.usedPercentage)}%, resets ${when(session.resetsAt, false)}.`);
  }
  if (data.panes.length) {
    lines.push("", "Context sent with each turn (largest first, the first to start fresh):");
    for (const p of data.panes.slice(0, 4)) lines.push(`  ${formatTokens(p.context)}  ${p.name}`);
  }
  lines.push("", `As of ${relTimeAgo(data.limits.at)}.`);

  return (
    <span className={`ledger-chip ${pace.status}`} title={lines.join("\n")}>
      {squirrel && <Critter kind="squirrel" size={19} className="ledger-squirrel" />}
      week {Math.round(pace.used)}%
      <span className="ledger-bar" aria-hidden>
        <span className="ledger-fill" style={{ width: `${Math.min(pace.used, 100)}%` }} />
        <span className="ledger-tick" style={{ left: `${pace.expected}%` }} />
      </span>
      <span className="ledger-label">{LABEL[pace.status]}</span>
    </span>
  );
}
