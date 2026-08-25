import { useRef, type ReactNode } from "react";
import { renderMarkdown } from "./markdown.ts";
import { Splitter, clamp } from "./Splitter.tsx";
import { TicketComments } from "./TicketComments.tsx";
import { usePersistentNumber, usePersistentString } from "./usePersistent.ts";
import type { LinearIssue } from "../../server/linear.ts";

// A "just looking" ticket session: the ticket detail (Description / Comments
// tabs) above, the Claude pane below, one draggable splitter. The tab and the
// split are persisted, so they survive session switches and restarts.
export function TicketLookView({
  ticketId,
  issues,
  onWork,
  header,
  terminal,
}: {
  ticketId: string | null;
  issues: LinearIssue[];
  /** "work on it" — open the work dialog for this issue. */
  onWork: (issue: LinearIssue) => void;
  header: ReactNode;
  terminal: ReactNode;
}) {
  const issue = issues.find((i) => i.identifier === ticketId);
  const [lookTab, setLookTab] = usePersistentString("den.lookTab", "description", [
    "description",
    "comments",
  ] as const);
  const [lookFrac, setLookFrac] = usePersistentNumber("den.lookFrac", 0.42);
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div className="look-view" ref={rootRef}>
      <div className="ws-pane" style={{ flex: `${lookFrac} 1 0` }}>
        <div className="ticket-detail">
          <div className="ticket-detail-head">
            {issue && (
              <span className="state-dot" style={{ background: issue.state.color }} />
            )}
            <strong>{ticketId}</strong>
            {issue && <span className="issue-state">{issue.state.name}</span>}
            {issue && (
              <a
                className="link-chip issue"
                href={issue.url}
                target="_blank"
                rel="noreferrer"
              >
                Linear ↗
              </a>
            )}
            <button
              className="btn btn-primary"
              style={{ marginLeft: "auto" }}
              disabled={!issue}
              onClick={() => issue && onWork(issue)}
            >
              work on it
            </button>
          </div>
          {issue && <div className="ticket-detail-title">{issue.title}</div>}
          <div className="ticket-look-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={lookTab === "description"}
              className={`look-tab${lookTab === "description" ? " active" : ""}`}
              onClick={() => setLookTab("description")}
            >
              Description
            </button>
            <button
              role="tab"
              aria-selected={lookTab === "comments"}
              className={`look-tab${lookTab === "comments" ? " active" : ""}`}
              onClick={() => setLookTab("comments")}
            >
              Comments
            </button>
          </div>
          <div className="ticket-detail-body">
            {lookTab === "description" ? (
              !issue ? (
                <div className="placeholder">
                  Ticket details aren't in your assigned list right now.
                </div>
              ) : issue.description ? (
                <div
                  className="ticket-detail-desc md"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdown(issue.description),
                  }}
                />
              ) : (
                <div className="placeholder">No description.</div>
              )
            ) : ticketId ? (
              <TicketComments ticketId={ticketId} />
            ) : null}
          </div>
        </div>
      </div>
      <Splitter
        dir="y"
        onDrag={(d) => {
          const h = rootRef.current?.clientHeight ?? 1;
          setLookFrac((f) => clamp(f + d / h, 0.15, 0.8));
        }}
      />
      <div className="ws-main" style={{ flex: `${1 - lookFrac} 1 0` }}>
        {header}
        {terminal}
      </div>
    </div>
  );
}
