import type { PullRequest } from "../../server/github.ts";
import type { LinearIssue } from "../../server/linear.ts";
import type { SessionMeta } from "../../server/sessions.ts";

// Ticket / PR chips for a session (workspace header + rail rows). The session's
// *explicit* link (the ticket or PR it was opened for) wins — that's what makes
// the chip correct per session. Only sessions that were never linked to one
// explicitly fall back to matching their branch's ticket hint against your open
// work. Renders null when the session has nothing to link.
export function WorkLinkChips({
  s,
  issues,
  prs,
  wrapClass,
}: {
  s: SessionMeta;
  issues: LinearIssue[];
  prs: PullRequest[];
  /** When set, the chips are wrapped in a span with this class (rail rows). */
  wrapClass?: string;
}) {
  const hint = s.ticketHint;
  // A real Linear identifier looks like ABC-123 (skips sentinels like
  // "den:self-edit").
  const explicitTicket =
    s.ticket && /^[A-Za-z]+-\d+$/.test(s.ticket) ? s.ticket : null;
  const issue = explicitTicket
    ? issues.find((i) => i.identifier === explicitTicket)
    : hint
      ? issues.find((i) => i.ticketHint.toLowerCase() === hint)
      : undefined;
  const pr =
    s.pr && s.prRepo
      ? prs.find((p) => p.number === s.pr && p.repo === s.prRepo)
      : hint
        ? prs.find((p) => p.ticketHint?.toLowerCase() === hint)
        : undefined;

  // Show the id/number even if the item isn't in your current lists (merged,
  // closed, someone else's) — a chip without a link, so it's still correct.
  const ticketId = issue?.identifier ?? explicitTicket;
  const prNum = pr?.number ?? (s.pr && s.prRepo ? s.pr : null);
  if (!ticketId && !prNum && s.view !== "review") return null;

  const check =
    pr?.checks === "passing"
      ? "✓"
      : pr?.checks === "failing"
        ? "✕"
        : pr?.checks === "pending"
          ? "◐"
          : "";
  const chips = (
    <>
      {s.view === "review" && (
        <span className="link-chip review" title="reviewing this PR — read-only toward GitHub">
          review
        </span>
      )}
      {ticketId &&
        (issue ? (
          <a
            className="link-chip issue"
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            title={issue.title}
            onClick={(e) => e.stopPropagation()}
          >
            {ticketId}
          </a>
        ) : (
          <span className="link-chip issue" title="linked ticket">
            {ticketId}
          </span>
        ))}
      {prNum &&
        (pr ? (
          <a
            className={`link-chip pr ${pr.checks}`}
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            title={pr.title}
            onClick={(e) => e.stopPropagation()}
          >
            PR #{prNum} {check}
          </a>
        ) : (
          <span className="link-chip pr" title="linked PR">
            PR #{prNum}
          </span>
        ))}
    </>
  );
  return wrapClass ? <span className={wrapClass}>{chips}</span> : chips;
}
