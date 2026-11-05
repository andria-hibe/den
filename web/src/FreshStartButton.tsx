import { useState } from "react";
import { anchorBelow, ConfirmCard, type CardAnchor } from "./ConfirmCard.tsx";

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
  const [confirming, setConfirming] = useState<CardAnchor | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onFresh();
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <>
      <button
        className="btn btn-ghost-outline restart-btn"
        disabled={busy}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (!running) void run();
          else setConfirming(confirming ? null : anchorBelow(e.currentTarget));
        }}
        aria-label="start fresh from the handover"
        title="Start fresh: a new conversation that picks up from the handover, instead of reloading this whole chat. The session brings its handover up to date first. The old conversation stays in Resume."
      >
        {busy ? "✦ saving handover…" : "✦"}
      </button>
      {confirming && (
        <ConfirmCard
          at={confirming}
          message="End this chat and start fresh? It updates its handover first."
          confirmLabel="start fresh"
          busyLabel="saving handover…"
          busy={busy}
          onConfirm={run}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
