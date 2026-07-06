import { useState } from "react";
import type { PullRequest } from "../../server/github.ts";

// Shown when you click a GitHub PR. Others' PRs → review; your own → edit.
export function PrDialog({
  pr,
  onReview,
  onEditMine,
  onClose,
}: {
  pr: PullRequest;
  onReview: (pr: PullRequest, opts: { preReview: boolean }) => void;
  onEditMine: (pr: PullRequest, env: "local" | "worktree") => void;
  onClose: () => void;
}) {
  const [preReview, setPreReview] = useState(true);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>
            {pr.isMine ? "Your PR" : "Review PR"} · {pr.repo.split("/")[1]} #
            {pr.number}
          </strong>
          <button className="btn-ghost" onClick={onClose} title="cancel">
            ×
          </button>
        </div>

        <div className="ticket-summary">
          <div className="ticket-summary-title">{pr.title}</div>
          <div className="ticket-summary-meta">
            {pr.checks} checks · {pr.review.replace(/_/g, " ")}
          </div>
        </div>

        {pr.isMine ? (
          <>
            <div className="ticket-branch">
              checkout <code>{pr.branch}</code> to make changes:
            </div>
            <div className="choose-grid">
              <button
                className="choose-card work"
                onClick={() => onEditMine(pr, "worktree")}
              >
                <div className="choose-emoji">🌿</div>
                <div className="choose-text">
                  <div className="choose-title">New workspace</div>
                  <div className="choose-sub">a separate git worktree</div>
                </div>
              </button>
              <button
                className="choose-card other"
                onClick={() => onEditMine(pr, "local")}
              >
                <div className="choose-emoji">💻</div>
                <div className="choose-text">
                  <div className="choose-title">Default local</div>
                  <div className="choose-sub">check out in your runn folder</div>
                </div>
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="pr-prereview">
              <input
                type="checkbox"
                checked={preReview}
                onChange={(e) => setPreReview(e.target.checked)}
              />
              Have Claude pre-review the diff
            </label>
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={() => onReview(pr, { preReview })}
            >
              start review →
            </button>
          </>
        )}
      </div>
    </div>
  );
}
