import { useState } from "react";

/** Starts a workspace's Claude pane on a new conversation that picks up from
 * its handover (#43). A running pane is ended first, so it asks. The server
 * has the session update a handover that's behind before ending it, which
 * can take a minute. */
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
        End this chat and start fresh? It updates its handover first.
        <button className="btn btn-primary own-pr-btn" disabled={busy} onClick={run}>
          {busy ? "saving handover…" : "start fresh"}
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
      aria-label="start fresh from the handover"
      title="Start fresh: a new conversation that picks up from the handover, instead of reloading this whole chat. The session brings its handover up to date first. The old conversation stays in Resume."
    >
      {busy ? "✦ saving handover…" : "✦"}
    </button>
  );
}
