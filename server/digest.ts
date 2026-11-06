// What den knows at the start of a day, for the Manager pane (#46). den's own
// polling gathers it (sessions, handovers, PRs, Linear, the plan's limits) so
// the Manager reads one file instead of re-polling GitHub, which has hit its
// secondary rate limit before.
import { SESSION_NOTES_HEADING } from "../shared/handover.ts";
import type { Pace } from "../shared/pace.ts";
import type { GhNotification, OpenThread, PrBuckets, PullRequest, TeamPr } from "./github.ts";
import type { LinearData, LinearNotification } from "./linear.ts";
import type { StackStatus } from "./stack.ts";

export interface DigestSession {
  /** The workspace's group id, to tell which sessions are new next time. */
  groupId: string;
  /** The name other sessions use to message it (ListAgents): the name its
   * Claude was started with, which a later retitle in den doesn't change. */
  name: string;
  /** What den's rail shows, when that differs from `name`. */
  title: string | null;
  /** Where its handover is, when it keeps one. */
  handoverPath: string | null;
  /** Not in the previous digest. */
  isNew: boolean;
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
  /** Unread inbox items; null when that source didn't answer. */
  inbox: { linear: LinearNotification[] | null; github: (GhNotification & { requested?: "named" | "team" })[] | null };
  /** Open review threads per authored PR; null where GitHub didn't answer. */
  reviewThreads?: { pr: number; threads: OpenThread[] | null }[] | null;
  /** The same for others' PRs the developer reviews or could pick up. */
  othersThreads?: { pr: number; threads: OpenThread[] | null }[];
  /** PRs asking the developer's team, not them, for a review, already
   * through `pickupPrs`; null when GitHub didn't answer. */
  teamPrs?: TeamPr[] | null;
}

/** Team PRs worth offering the developer to pick up: not failing CI, and not
 * one a den session is already on (by branch or PR number). */
export function pickupPrs(prs: TeamPr[], sessions: { branch: string | null; pr: number | null }[]): TeamPr[] {
  const branches = new Set(sessions.map((s) => s.branch).filter(Boolean));
  const numbers = new Set(sessions.map((s) => s.pr).filter(Boolean));
  return prs.filter((p) => p.checks !== "failing" && !branches.has(p.branch) && !numbers.has(p.number));
}

/** Checks failing on more than one of the developer's PRs: the same failure
 * across branches is usually the base branch or CI itself, not the work. */
export function sharedFailures(prs: PullRequest[]): { check: string; prs: number[] }[] {
  const by = new Map<string, number[]>();
  for (const p of prs) {
    for (const c of p.failingChecks ?? []) by.set(c.name, [...(by.get(c.name) ?? []), p.number]);
  }
  return [...by.entries()]
    .filter(([, nums]) => nums.length > 1)
    .map(([check, nums]) => ({ check, prs: nums }));
}

/** The GitHub inbox with each review request tagged by who it asks: the
 * developer by name, or only a team they're in. A request that is neither any
 * more (merged, closed, reviewed, or withdrawn) is dropped. Untouched when
 * GitHub didn't answer either PR search, since nothing can be told apart. */
export function tagReviewRequests(
  notifs: GhNotification[],
  named: PullRequest[] | null,
  team: TeamPr[] | null,
): (GhNotification & { requested?: "named" | "team" })[] {
  if (!named || !team) return notifs;
  const key = (repo: string, n: number) => `${repo}#${n}`;
  const namedKeys = new Set(named.filter((p) => p.reviewRequestedFromMe).map((p) => key(p.repo, p.number)));
  const teamKeys = new Set(team.map((p) => key(p.repo, p.number)));
  return notifs.flatMap((n) => {
    const num = n.reason === "review_requested" ? /\/pull\/(\d+)/.exec(n.url ?? "")?.[1] : undefined;
    if (!num) return [n];
    const k = key(n.repo, Number(num));
    if (namedKeys.has(k)) return [{ ...n, requested: "named" as const }];
    if (teamKeys.has(k)) return [{ ...n, requested: "team" as const }];
    return [];
  });
}

/** The PR state file Fox checks before presenting an item about a PR, since
 * the digest is only as fresh as the last start or refresh. */
export function buildPrState(now: number, prs: PrBuckets | null, team: TeamPr[] | null): string {
  const out = [
    `# Open PRs, read ${new Date(now).toISOString()}`,
    "",
    "A PR not listed here is merged, closed, or no longer involves me.",
    "",
  ];
  if (!prs) out.push("GitHub didn't answer for my PRs.");
  else out.push("Mine:", ...prs.authored.map(prLine), "", "Review requested or reviewed by me:", ...prs.reviewRequested.map(prLine));
  out.push("", "My team's, nobody has reviewed yet:");
  if (!team) out.push("- (GitHub didn't answer)");
  else if (!team.length) out.push("- none");
  for (const p of team ?? []) out.push(`- #${p.number} ${p.title} (${p.repo}) - by ${p.author}, CI ${p.checks}`);
  return out.join("\n") + "\n";
}

function threadLines(groups: { pr: number; threads: OpenThread[] | null }[], mine: boolean): string[] {
  const out: string[] = [];
  for (const p of groups) {
    if (!p.threads) out.push(`- #${p.pr}: (GitHub didn't answer)`);
    for (const t of p.threads ?? []) {
      const body = t.body.replace(/\s+/g, " ").trim();
      const at = `${t.path}${t.line ? `:${t.line}` : ""}`;
      const state = mine ? (t.waitingOnMe ? ", waiting on me" : ", I replied last") : "";
      const replies = t.replies ? `, ${t.replies} repl${t.replies === 1 ? "y" : "ies"}` : "";
      const max = mine ? 300 : 150;
      out.push(`- #${p.pr} ${at}, ${t.author}${replies}${state}: "${body.length > max ? `${body.slice(0, max)}...` : body}"`);
    }
  }
  return out;
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
    p.failingChecks?.length ? `failing: ${p.failingChecks.map((c) => `${c.name} (${c.link ?? "no link"})`).join("; ")}` : null,
  ].filter(Boolean);
  return `- #${p.number} ${p.title} (${p.repo}, ${p.branch ?? "?"}) - ${bits.join(", ")}`;
}

export function buildDigest(d: DigestInput): string {
  const at = new Date(d.now);
  const local = `${at.toDateString()} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  const out: string[] = [
    `# den digest, ${local} local (${at.toISOString()})`,
    "",
    "den wrote this from live GitHub and Linear reads at that time.",
    "",
  ];

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
    const about = [
      s.isNew ? "New since the last digest." : null,
      s.title ? `den's rail shows it as "${s.title}".` : null,
      s.handoverPath ? `Handover: ${s.handoverPath}` : "Keeps no handover.",
    ].filter(Boolean);
    out.push(about.join(" "), "");
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

  if (d.prs) {
    const shared = sharedFailures(d.prs.authored);
    if (shared.length) {
      out.push("The same check is failing on several of my PRs:");
      for (const f of shared) out.push(`- ${f.check}: ${f.prs.map((n) => `#${n}`).join(", ")}`);
      out.push("");
    }
  }

  if (d.teamPrs !== undefined) {
    out.push(
      "## Team PRs to pick up",
      "",
      "Open PRs asking my team, not me, for a review. Already left out: drafts, ones I wrote or reviewed, approved ones, failing CI, and ones a session is on.",
      "",
    );
    if (!d.teamPrs) out.push("- (GitHub didn't answer)");
    else if (!d.teamPrs.length) out.push("- none");
    for (const p of d.teamPrs ?? []) {
      const bits = [
        p.author.startsWith("dependabot") ? "dependabot" : `by ${p.author}`,
        `+${p.additions}/-${p.deletions} in ${p.files} file${p.files === 1 ? "" : "s"}`,
        `CI ${p.checks}`,
        `${p.approvals} approval${p.approvals === 1 ? "" : "s"}`,
        p.review === "changes_requested" ? "changes requested" : null,
      ].filter(Boolean);
      out.push(`- #${p.number} ${p.title} (${p.repo}, ${p.url}) - ${bits.join(", ")}`);
    }
    out.push("");
  }

  out.push("## Inbox", "", "Linear, unread:");
  if (!d.inbox.linear) out.push("- (Linear didn't answer)");
  else if (!d.inbox.linear.length) out.push("- nothing unread");
  for (const n of d.inbox.linear ?? []) {
    const about = n.issue ? `${n.issue.identifier} ${n.issue.title}` : (n.title ?? "(no issue)");
    const link = n.issue?.url ?? n.url;
    out.push(`- ${n.type} from ${n.actor ?? "someone"} on ${about}${link ? ` (${link})` : ""}${n.comment ? `: "${n.comment}"` : ""}`);
  }
  out.push("", "GitHub, threads I take part in, since yesterday:");
  if (!d.inbox.github) out.push("- (GitHub didn't answer)");
  else if (!d.inbox.github.length) out.push("- nothing new");
  for (const n of d.inbox.github ?? []) {
    const reason = n.requested ? `${n.reason} (${n.requested === "named" ? "me by name" : "my team only"})` : n.reason;
    out.push(`- ${reason}: ${n.title} (${n.repo}${n.url ? `, ${n.url}` : ""})`);
  }
  if (d.reviewThreads !== undefined) {
    out.push("", "GitHub, open review threads on my PRs:");
    if (!d.reviewThreads) out.push("- (GitHub didn't answer)");
    else if (d.reviewThreads.every((p) => p.threads && !p.threads.length)) out.push("- none open");
    out.push(...threadLines(d.reviewThreads ?? [], true));
  }
  if (d.othersThreads?.length) {
    out.push("", "GitHub, open review threads on PRs I review or could pick up:");
    if (d.othersThreads.every((p) => p.threads && !p.threads.length)) out.push("- none open");
    out.push(...threadLines(d.othersThreads, false));
  }
  out.push("");

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
