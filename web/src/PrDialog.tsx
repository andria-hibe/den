import { usePersistentString } from "./usePersistent.ts";
import type { PullRequest } from "../../server/github.ts";

/** What Claude does first when a review opens (#11): the full pass (reading
 * guide, then the code-review skill), the cheap reading guide only for a PR
 * small enough to read yourself, or nothing until you ask. */
export type PreReview = "full" | "guide" | "none";

export function PrDialog({
  pr,
  onReview,
  onEditMine,
  onClose,
}: {
  pr: PullRequest;
  onReview: (pr: PullRequest, opts: { preReview: PreReview }) => void;
  onEditMine: (pr: PullRequest, env: "local" | "worktree") => void;
  onClose: () => void;
}) {
  // Remembered, so a small-PR habit sticks.
  const [preReview, setPreReview] = usePersistentString("den.preReview", "full", [
    "full",
    "guide",
    "none",
  ] as const);

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
                  <div className="choose-sub">check out in your work repo</div>
                </div>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="pr-prereview-group" role="radiogroup" aria-label="what Claude does first">
              {(
                [
                  ["full", "Full pre-review", "reading guide, then the code-review pass"],
                  ["guide", "Reading guide only", "cheaper, for a PR small enough to read yourself"],
                  ["none", "Nothing yet", "ask from the Guide or Review tab when you want"],
                ] as const
              ).map(([value, label, sub]) => (
                <label key={value} className="pr-prereview">
                  <input
                    type="radio"
                    name="prereview"
                    checked={preReview === value}
                    onChange={() => setPreReview(value)}
                  />
                  <span>
                    {label}
                    <span className="pr-prereview-sub"> · {sub}</span>
                  </span>
                </label>
              ))}
            </div>
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
