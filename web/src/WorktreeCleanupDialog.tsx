import { useState } from "react";
import { api } from "./api.ts";
import { describeLoss, losesWork } from "./worktreeCleanup.ts";
import type { WorktreeInfo } from "../../server/git.ts";

// Offered after you close a session that was working in a worktree den made
// (and nothing else is using it): keep the worktree, or remove it. Removing
// keeps the branch; the dialog says what, if anything, would be lost, and a
// removal that loses work is labelled that way rather than hidden.
export function WorktreeCleanupDialog({
  worktree,
  onDone,
  onError,
}: {
  worktree: WorktreeInfo;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const risky = losesWork(worktree.changes);

  const remove = async () => {
    setBusy(true);
    try {
      await api("/api/git/worktrees/remove", {
        method: "POST",
        body: JSON.stringify({ path: worktree.path, force: risky }),
      });
      onDone();
    } catch (e) {
      onError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onDone}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Remove its worktree?</strong>
          <button className="btn-ghost" onClick={onDone} title="keep it">
            ×
          </button>
        </div>
        <div className="ticket-summary">
          <div className="ticket-summary-title">
            🌿 {worktree.branch ?? `detached @ ${worktree.head}`}
          </div>
          <div className="ticket-summary-meta">{worktree.path}</div>
        </div>
        <p className={`wt-loss${risky ? " risky" : ""}`}>{describeLoss(worktree.changes)}</p>
        <div className="modal-foot">
          <button className="btn" onClick={onDone} disabled={busy}>
            keep it
          </button>
          <button
            className={`btn ${risky ? "btn-danger" : "btn-primary"}`}
            onClick={remove}
            disabled={busy}
          >
            {busy ? "removing…" : risky ? "remove anyway" : "remove worktree"}
          </button>
        </div>
      </div>
    </div>
  );
}
