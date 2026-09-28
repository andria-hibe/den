import { useState } from "react";
import { api } from "./api.ts";
import { describeLoss, losesWork } from "./worktreeCleanup.ts";
import type { WorktreeInfo } from "../../server/git.ts";
import { shortCommand } from "./AppRunButton.tsx";

/** A checkout's running stack, offered for teardown when its workspace closes. */
export interface StackToStop {
  /** The checkout the stack belongs to (the teardown runs there). */
  dir: string;
  name: string;
  command: string;
  containersUp: number;
}

// Offered after you close a session, for what it leaves behind (#15, #28):
// - a stack still running for that checkout: stop it (runn down), so its
//   containers don't outlive the work;
// - a worktree den made that nothing else uses: remove it. Removing keeps the
//   branch; the dialog says what, if anything, would be lost, and a removal
//   that loses work starts unticked and is labelled as such.
// Stopping runs first, since a stack whose checkout is gone can't be found by
// its own teardown any more.
export function WorktreeCleanupDialog({
  worktree,
  stack,
  onDone,
  onError,
}: {
  worktree: WorktreeInfo | null;
  stack: StackToStop | null;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const risky = losesWork(worktree?.changes);
  const [stopStack, setStopStack] = useState(!!stack);
  const [removeTree, setRemoveTree] = useState(!!worktree && !risky);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async () => {
    try {
      if (stack && stopStack) {
        setBusy(`stopping ${stack.name}…`);
        await api("/api/app/stop-dir", { method: "POST", body: JSON.stringify({ path: stack.dir }) });
      }
      if (worktree && removeTree) {
        setBusy("removing the worktree…");
        await api("/api/git/worktrees/remove", {
          method: "POST",
          body: JSON.stringify({ path: worktree.path, force: risky }),
        });
      }
      onDone();
    } catch (e) {
      onError((e as Error).message);
      setBusy(null);
    }
  };

  const anything = (stack && stopStack) || (worktree && removeTree);
  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onDone}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Clean up after this session?</strong>
          <button className="btn-ghost" onClick={onDone} title="leave everything" disabled={!!busy}>
            ×
          </button>
        </div>
        {stack && (
          <label className="cleanup-option">
            <input type="checkbox" checked={stopStack} onChange={(e) => setStopStack(e.target.checked)} />
            <span>
              Stop its stack
              <span className="cleanup-sub">
                {" "}
                {stack.containersUp} container{stack.containersUp === 1 ? "" : "s"} up · runs{" "}
                <code title={stack.command}>{shortCommand(stack.command)}</code>
              </span>
            </span>
          </label>
        )}
        {worktree && (
          <label className="cleanup-option">
            <input type="checkbox" checked={removeTree} onChange={(e) => setRemoveTree(e.target.checked)} />
            <span>
              Remove its worktree
              <span className="cleanup-sub"> 🌿 {worktree.branch ?? `detached @ ${worktree.head}`}</span>
              <span className={`wt-loss${risky ? " risky" : ""}`}>{describeLoss(worktree.changes)}</span>
            </span>
          </label>
        )}
        <div className="modal-foot">
          <button className="btn" onClick={onDone} disabled={!!busy}>
            leave everything
          </button>
          <button
            className={`btn ${worktree && removeTree && risky ? "btn-danger" : "btn-primary"}`}
            onClick={run}
            disabled={!!busy || !anything}
          >
            {busy ?? (worktree && removeTree && risky ? "clean up anyway" : "clean up")}
          </button>
        </div>
      </div>
    </div>
  );
}
