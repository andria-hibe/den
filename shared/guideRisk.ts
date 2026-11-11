// The reading guide's overall risk line, "Risk: <level> - <why>", which
// `reviewInstruction` asks for at the end of the guide's opening lines.

export type RiskLevel = "low" | "typical" | "high" | "very high";

export interface GuideRisk {
  level: RiskLevel;
  why: string;
}

// The level must end the word ("high-traffic" is a note, not a level), and
// the reason follows a spaced dash, a colon, a full stop, or parentheses.
const RISK_LINE =
  /^\s*(?:[-*+]\s+)?[*_]*(?:overall\s+)?risk(?:\s+level)?[*_]*\s*:\s*[*_]*\s*(very[ -]high|high|typical|medium|moderate|low)(?![-\w])[*_]*\s*(?:(?:\s[-\u2013\u2014]+\s|[:.;])\s*(.*)|\((.*)\)\.?)?\s*$/i;

const LEVEL: Record<string, RiskLevel> = { medium: "typical", moderate: "typical", "very-high": "very high" };

/** The first risk line in the guide's intro (before any heading), and the
 * intro without it. */
export function guideRisk(intro: string): { risk: GuideRisk | null; rest: string } {
  const lines = intro.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = RISK_LINE.exec(lines[i]);
    if (!m) continue;
    const rest = [...lines.slice(0, i), ...lines.slice(i + 1)].join("\n");
    const word = m[1].toLowerCase();
    return { risk: { level: LEVEL[word] ?? (word as RiskLevel), why: (m[2] ?? m[3] ?? "").trim() }, rest };
  }
  return { risk: null, rest: intro };
}
