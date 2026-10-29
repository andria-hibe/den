import type { PullRequest } from "../../server/github.ts";
import { useAppName } from "./appName.ts";
import type { LinearIssue } from "../../server/linear.ts";
import type { SessionMeta } from "../../server/sessions.ts";

// Ticket / PR chips for a session. The ticket or PR it was opened for wins;
// only a session with no explicit link falls back to its branch's ticket hint.
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
  const app = useAppName();
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
  // Behind the repo's base branch is normal and not worth a chip; behind a
  // stacked parent or origin means work to pull in (#33).
  const st = s.stack;
  const behindParent = st?.stacked ? st.behindParent : 0;
  const behindOrigin = st?.behindOrigin ?? 0;
  const waiting = s.waiting ?? [];
  if (!ticketId && !prNum && s.view !== "review" && !behindParent && !behindOrigin && !waiting.length) return null;

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
      {waiting.length > 0 && (
        <span className="link-chip needs-you" title={`Waiting on you:\n${waiting.map((w) => `- ${w}`).join("\n")}`}>
          needs you
        </span>
      )}
      {s.view === "review" && (
        <span className="link-chip review" title="reviewing this PR — read-only toward GitHub">
          review
        </span>
      )}
      {ticketId &&
        (issue ? (
          <a
            className={`link-chip issue${s.ticketChanged ? " edited" : ""}`}
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            title={
              s.ticketChanged
                ? `${issue.title}: the description changed since this workspace opened; ${app} told the session what changed`
                : issue.title
            }
            onClick={(e) => e.stopPropagation()}
          >
            {ticketId}
            {s.ticketChanged && " · edited"}
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
      {behindParent > 0 && (
        <span
          className="link-chip behind"
          title={`${st!.parent} has ${behindParent} commit${behindParent === 1 ? "" : "s"} this branch doesn't`}
        >
          base +{behindParent}
        </span>
      )}
      {behindOrigin > 0 && (
        <span
          className="link-chip behind"
          title={`origin has ${behindOrigin} commit${behindOrigin === 1 ? "" : "s"} on this branch that this checkout doesn't`}
        >
          origin +{behindOrigin}
        </span>
      )}
    </>
  );
  return wrapClass ? <span className={wrapClass}>{chips}</span> : chips;
}
