// The shape of a workspace notepad (#27): four sections for the developer,
// then session notes for the next session. Shared so the server's seed and
// instruction (sessions.ts), the client's ticket seed (prompts.ts), and
// NotepadPane all name the same headings.
import type { LinearIssue } from "../server/linear.ts";

export const HANDOVER_HEADINGS = [
  "Where it stands",
  "Done",
  "Next",
  "Waiting on you",
] as const;

/** The session-to-session handover, below the developer's sections. */
export const SESSION_NOTES_HEADING = "Session notes";

/** The empty handover a new notepad starts with. */
export const HANDOVER_TEMPLATE =
  "## Where it stands\n\nNot started yet.\n\n" +
  "## Done\n\n" +
  "## Next\n\n" +
  "## Waiting on you\n\nNothing.\n\n" +
  "---\n\n" +
  `## ${SESSION_NOTES_HEADING}\n\nNothing yet.\n`;

/** Is this notepad a handover (as opposed to an older running log)? */
export function isHandover(md: string): boolean {
  return md.includes(`## ${HANDOVER_HEADINGS[0]}`);
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** How long a handover can get, ticket aside, before den asks the session to
 * trim it: every fresh start and every Fox digest pays to read it. */
export const HANDOVER_LONG_CHARS = 12_000;

/** A notepad's length without its ticket section, which isn't the
 * session's to trim. */
export function handoverLength(notepad: string, ticket: string): number {
  const t = ticket.trim();
  return t && squash(notepad).includes(squash(t)) ? Math.max(0, notepad.length - t.length) : notepad.length;
}

/** The notepad with the ticket section put back at the end, or null when the
 * ticket is still there. Whitespace is ignored when comparing, so a session
 * that reflows the file doesn't get a second copy (#39). */
export function restoreTicket(notepad: string, ticket: string): string | null {
  if (!ticket.trim() || squash(notepad).includes(squash(ticket))) return null;
  return `${notepad.trimEnd()}\n\n---\n\n${ticket.trim()}\n`;
}

/** The description in a ticket section (`ticketDetails` in web/src/prompts.ts
 * writes it after the "## Ticket" heading). */
export function ticketDescription(section: string): string | null {
  const at = section.indexOf("\n## Ticket\n\n");
  return at < 0 ? null : section.slice(at + "\n## Ticket\n\n".length).trim();
}

/** Lines removed ("- ") and added ("+ ") between two texts, ignoring order
 * and blank lines: enough to show what a ticket edit changed (#38). */
export function lineChanges(before: string, after: string, max = 40): string[] {
  const a = before.split("\n").map((l) => l.trim()).filter(Boolean);
  const b = after.split("\n").map((l) => l.trim()).filter(Boolean);
  const out = [
    ...a.filter((l) => !b.includes(l)).map((l) => `- ${l}`),
    ...b.filter((l) => !a.includes(l)).map((l) => `+ ${l}`),
  ];
  return out.length > max ? [...out.slice(0, max), `(${out.length - max} more lines)`] : out;
}

type PaneKind = {
  shell: boolean;
  role: string;
  look: unknown;
  view: unknown;
  owned?: boolean;
};

/** A pane that works like a workspace and so writes a handover: a workspace
 * main pane, a my-PR pane, or a review pane the developer has taken on as
 * their own PR. */
export function worksLikeWorkspace(s: PaneKind): boolean {
  if (s.shell || s.role !== "main" || s.look) return false;
  return !s.view || s.view === "mypr" || (s.view === "review" && !!s.owned);
}

/** Only a pane keeping a handover, or the Manager (which always keeps one),
 * has a handover to start fresh from. */
export function canStartFresh(s: PaneKind & { handover: boolean }): boolean {
  if (s.shell || s.role !== "main") return false;
  return s.view === "manager" || (worksLikeWorkspace(s) && s.handover);
}

/** The items under a handover's "Waiting on you", one per bullet or line;
 * empty when the section says "Nothing." or is missing. */
export function waitingItems(md: string): string[] {
  const head = `## ${HANDOVER_HEADINGS[3]}`;
  const at = md.indexOf(head);
  if (at < 0) return [];
  const rest = md.slice(at + head.length);
  const end = rest.search(/\n(## |---)/);
  const lines = (end < 0 ? rest : rest.slice(0, end))
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim())
    .filter(Boolean);
  return lines.length === 1 && /^nothing\.?$/i.test(lines[0]) ? [] : lines;
}

/** A ticket's details as markdown, without its title. */
/** The ticket section of a workspace notepad. den keeps a copy and puts it
 * back if a rewrite drops it (#39). */
export function ticketDetails(issue: LinearIssue): string {
  const parts = [`**State:** ${issue.state.name} | **Priority:** ${issue.priorityLabel}`];
  if (issue.branchName) parts.push(`**Branch:** \`${issue.branchName}\``);
  parts.push(
    `[Open in Linear](${issue.url})`,
    "",
    "## Ticket",
    "",
    issue.description?.trim() || "_(no description)_",
    "",
  );
  return parts.join("\n");
}

/** The notepad a ticket workspace starts with: the empty handover first, so
 * it opens on where the work stands, then the ticket. After a restart this is
 * the session's only copy of the ticket. */
export function ticketNotesSeed(issue: LinearIssue): string {
  return (
    `# ${issue.identifier}: ${issue.title}\n\n${HANDOVER_TEMPLATE}\n---\n\n` +
    ticketDetails(issue)
  );
}

