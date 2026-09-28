import { useState } from "react";
import type { LinearIssue } from "../../server/linear.ts";
import { BasePicker, useWorkBases } from "./BasePicker.tsx";

// Shown when you click a Linear ticket: look at it, or work on it (in a new
// worktree or the default local checkout).
export function TicketDialog({
  issue,
  startAtWork = false,
  onLook,
  onWork,
  onClose,
}: {
  issue: LinearIssue;
  startAtWork?: boolean;
  onLook: (issue: LinearIssue) => void;
  /** `base`: start the new branch from this branch instead of the repo base. */
  onWork: (issue: LinearIssue, env: "local" | "worktree", base: string | null) => void;
  onClose: () => void;
}) {
  const [work, setWork] = useState(startAtWork);
  const [base, setBase] = useState<string | null>(null);
  const bases = useWorkBases();
  // A branch that already has a worktree is reused as it is, so a base means
  // nothing there; don't offer one.
  const hasWorkspace = !!bases?.worktrees.some((w) => w.branch === issue.branchName);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              className="state-dot"
              style={{ background: issue.state.color }}
            />
            {issue.identifier}
          </strong>
          <button className="btn-ghost" onClick={onClose} title="cancel">
            ×
          </button>
        </div>

        <div className="ticket-summary">
          <div className="ticket-summary-title">{issue.title}</div>
          <div className="ticket-summary-meta">
            {issue.state.name}
            {issue.project ? ` · ${issue.project}` : ""}
          </div>
        </div>

        {!work ? (
          <div className="choose-grid">
            <button className="choose-card personal" onClick={() => onLook(issue)}>
              <div className="choose-emoji">👀</div>
              <div className="choose-text">
                <div className="choose-title">Just look</div>
                <div className="choose-sub">
                  read the ticket with a Claude session — no branch yet
                </div>
              </div>
            </button>
            <button className="choose-card work" onClick={() => setWork(true)}>
              <div className="choose-emoji">🛠️</div>
              <div className="choose-text">
                <div className="choose-title">Work on it</div>
                <div className="choose-sub">create the branch &amp; start working</div>
              </div>
            </button>
          </div>
        ) : (
          <>
            <div className="ticket-branch">
              branch: <code>{issue.branchName ?? "(no branch name)"}</code>
              {hasWorkspace && " (already has a workspace, reused as it is)"}
            </div>
            {bases && !hasWorkspace && (
              <BasePicker
                base={bases.base}
                worktrees={bases.worktrees}
                creating={issue.branchName}
                value={base}
                onChange={setBase}
              />
            )}
            <div className="choose-grid">
              <button
                className="choose-card work"
                onClick={() => onWork(issue, "worktree", base)}
                disabled={!issue.branchName}
              >
                <div className="choose-emoji">🌿</div>
                <div className="choose-text">
                  <div className="choose-title">New workspace</div>
                  <div className="choose-sub">
                    a separate git worktree — work on several tickets at once
                  </div>
                </div>
              </button>
              <button
                className="choose-card other"
                onClick={() => onWork(issue, "local", base)}
                disabled={!issue.branchName}
              >
                <div className="choose-emoji">💻</div>
                <div className="choose-text">
                  <div className="choose-title">Default local</div>
                  <div className="choose-sub">
                    check out the branch in your work repo
                  </div>
                </div>
              </button>
            </div>
            {!startAtWork && (
              <button
                className="btn btn-ghost-outline"
                style={{ marginTop: 10 }}
                onClick={() => setWork(false)}
              >
                ‹ back
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
