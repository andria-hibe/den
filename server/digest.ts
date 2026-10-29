// What den knows at the start of a day, for the Manager pane (#46). den's own
// polling gathers it (sessions, handovers, PRs, Linear, the plan's limits) so
// the Manager reads one file instead of re-polling GitHub, which has hit its
// secondary rate limit before.
import { SESSION_NOTES_HEADING } from "../shared/handover.ts";
import type { Pace } from "../shared/pace.ts";
import type { PrBuckets, PullRequest } from "./github.ts";
import type { LinearData } from "./linear.ts";
import type { StackStatus } from "./stack.ts";

export interface DigestSession {
  name: string;
  /** The name other sessions use to message it (ListAgents), which is den's
   * pane name. */
  status: "running" | "exited";
  ticket: string | null;
  branch: string | null;
  pr: number | null;
  attention: boolean;
  stack: StackStatus | null;
  /** The notepad's developer sections, and when it was last written (epoch ms). */
  handover: { top: string; writtenAt: number } | null;
}

export interface DigestInput {
  now: number;
  sessions: DigestSession[];
  prs: PrBuckets | null;
  linear: LinearData | null;
  week: Pace | null;
}

/** The part of a handover written for the developer: everything above the
 * session notes (and the `---` before them). */
export function developerSections(md: string): string {
  const notes = md.indexOf(`## ${SESSION_NOTES_HEADING}`);
  const top = notes >= 0 ? md.slice(0, notes) : md;
  return top.replace(/\n-{3,}\s*$/, "").trim();
}

const ago = (now: number, at: number) => {
  const h = Math.round((now - at) / 3_600_000);
  return h < 1 ? "under an hour ago" : h < 48 ? `${h}h ago` : `${Math.round(h / 24)} days ago`;
};

const REVIEW_LABEL = {
  approved: "approved",
  changes_requested: "changes requested",
  review_required: "awaiting review",
  none: "",
} as const;

function prLine(p: PullRequest): string {
  const bits = [
    p.isDraft ? "draft" : null,
    `CI ${p.checks}`,
    p.review !== "none" ? REVIEW_LABEL[p.review] : null,
    p.mergeable === "CONFLICTING" ? "CONFLICTS with its base" : null,
    p.baseBranch ? `base ${p.baseBranch}` : null,
    p.needsAttention ? `NEEDS YOU: ${p.attentionReason ?? "yes"}` : null,
  ].filter(Boolean);
  return `- #${p.number} ${p.title} (${p.repo}, ${p.branch ?? "?"}) - ${bits.join(", ")}`;
}

export function buildDigest(d: DigestInput): string {
  const out: string[] = [`# den digest, ${new Date(d.now).toISOString()}`, ""];

  out.push("## Sessions", "");
  for (const s of d.sessions) {
    const meta = [
      s.status,
      s.ticket,
      s.branch && `branch ${s.branch}`,
      s.pr && `PR #${s.pr}`,
      s.attention && "rang for attention",
      s.stack?.stacked && `stacked on ${s.stack.parent}`,
      s.stack && s.stack.behindParent > 0 && `${s.stack.behindParent} behind ${s.stack.parent}`,
      s.stack && s.stack.behindOrigin > 0 && `${s.stack.behindOrigin} behind origin`,
    ].filter(Boolean);
    out.push(`### ${s.name}`, "", meta.join(" - "));
    if (s.handover) {
      out.push(`Handover written ${ago(d.now, s.handover.writtenAt)}:`, "", s.handover.top, "");
    } else {
      out.push("No handover.", "");
    }
  }

  out.push("## Pull requests", "");
  if (!d.prs) out.push("GitHub didn't answer; check `gh` yourself if it matters.", "");
  else {
    out.push("Mine:", ...d.prs.authored.map(prLine), "", "Review requested or reviewed by me:");
    out.push(...d.prs.reviewRequested.map(prLine), "");
  }

  out.push("## Linear", "");
  if (!d.linear) out.push("Not connected or didn't answer.", "");
  else {
    out.push(`Unread notifications in the Linear inbox: ${d.linear.unreadNotifications}.`, "", "Assigned:");
    for (const i of d.linear.issues) {
      out.push(`- ${i.identifier} ${i.title} - ${i.state.name}, ${i.priorityLabel}`);
    }
    out.push("");
  }

  out.push("## Token use", "");
  if (!d.week) out.push("No reading yet.");
  else {
    out.push(
      `Week: ${Math.round(d.week.used)}% used, an even pace would be ${Math.round(d.week.expected)}% (${d.week.status}).`,
    );
    if (d.week.runsOutAt) out.push(`At this rate it runs out ${new Date(d.week.runsOutAt).toISOString()}.`);
  }
  return out.join("\n") + "\n";
}
