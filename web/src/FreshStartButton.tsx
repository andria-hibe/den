import { useState } from "react";

/** Starts a workspace's Claude pane on a new conversation that picks up from
 * its handover (#43). A running pane is ended first, so it asks. */
export function FreshStartButton({
  running,
  onFresh,
}: {
  running: boolean;
  onFresh: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onFresh();
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <span className="own-pr-confirm">
        End this chat and start fresh from its handover?
        <button className="btn btn-primary own-pr-btn" disabled={busy} onClick={run}>
          {busy ? "starting…" : "start fresh"}
        </button>
        <button className="btn own-pr-btn" disabled={busy} onClick={() => setConfirming(false)}>
          cancel
        </button>
      </span>
    );
  }

  return (
    <button
      className="btn btn-ghost-outline restart-btn"
      disabled={busy}
      onClick={() => (running ? setConfirming(true) : run())}
      title="Start a new conversation that picks up from the handover, instead of reloading this whole chat. Check the handover is up to date first. The old conversation stays in Resume."
    >
      ✦ fresh
    </button>
  );
}
