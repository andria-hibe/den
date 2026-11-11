import type { GuideRisk } from "../../shared/guideRisk.ts";

/** A reading guide's overall risk for the whole PR, its reason in the hover tip. */
export function RiskChip({ risk }: { risk: GuideRisk }) {
  return (
    <span className={`pr-badge risk-chip risk-${risk.level.replace(" ", "-")}${risk.why ? " has-why" : ""}`} title={risk.why || undefined}>
      {risk.level} risk
    </span>
  );
}
