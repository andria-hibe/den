import type { BugIssue } from "../../server/linear.ts";
import { Md } from "./Md.tsx";
import { TicketComments } from "./TicketComments.tsx";

/** One line of what Fox's scout or triage helper found. */
export type BugFinding = { label: string; text: string };

/** A bug from the Bugs tab, for a quick read before taking it on. */
export function BugDialog({
  issue,
  note,
  findings = [],
  onWork,
  onClose,
}: {
  issue: BugIssue;
  /** Why bug buster left it out, or where it stands. */
  note?: string | null;
  findings?: BugFinding[];
  onWork: (issue: BugIssue) => void;
  onClose: () => void;
}) {
  const mine = !!issue.assignee?.isMe;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal bug-read" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="state-dot" style={{ background: issue.state.color }} />
            {issue.identifier}
          </strong>
          <span className="bug-read-head-actions">
            <a className="btn-ghost bug-read-link" href={issue.url} target="_blank" rel="noreferrer" title="open in Linear">
              Linear ↗
            </a>
            <button className="btn-ghost" onClick={onClose} title="cancel">
              ×
            </button>
          </span>
        </div>
        <div className="ticket-summary">
          <div className="ticket-summary-title">{issue.title}</div>
          <div className="ticket-summary-meta">
            {issue.state.name} · {issue.priorityLabel}
            {issue.assignee ? ` · assigned to ${mine ? "you" : issue.assignee.name}` : " · unassigned"}
          </div>
          {note && <div className="ticket-summary-meta">{note}</div>}
        </div>
        <div className="bug-read-scroll">
          {findings.length > 0 && (
            <div className="bug-read-findings">
              {findings.map((f) => (
                <div key={f.label}>
                  <span className="bug-read-label">{f.label}:</span> {f.text}
                </div>
              ))}
            </div>
          )}
          <Md text={issue.description?.trim() || "_(no description)_"} />
          <TicketComments ticketId={issue.identifier} />
        </div>
        <div className="bug-read-actions">
          {issue.assignee && !mine && (
            <span className="bug-read-warn">This takes it over from {issue.assignee.name}.</span>
          )}
          <button className="btn btn-primary" onClick={() => onWork(issue)} disabled={!issue.branchName}>
            {mine ? "Work on it" : "Assign to me and work on it"}
          </button>
        </div>
      </div>
    </div>
  );
}
