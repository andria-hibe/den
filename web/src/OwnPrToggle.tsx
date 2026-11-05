import { useState } from "react";
import { anchorBelow, ConfirmCard, type CardAnchor } from "./ConfirmCard.tsx";

/** A review pane's switch between reviewing someone else's PR and working on
 * it as your own (commit, push, post). Switching restarts a running Claude
 * pane into the same conversation, so it asks first. */
export function OwnPrToggle({
  owned,
  running,
  onSwitch,
}: {
  owned: boolean;
  running: boolean;
  onSwitch: (on: boolean) => Promise<void>;
}) {
  const [confirming, setConfirming] = useState<CardAnchor | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onSwitch(!owned);
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  return (
    <>
      <button
        className={`btn btn-ghost-outline own-pr-btn${owned ? " on" : ""}`}
        disabled={busy}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          if (!running) void run();
          else setConfirming(confirming ? null : anchorBelow(e.currentTarget));
        }}
        title={
          owned
            ? "Claude is working on this PR as yours: it can edit, commit, push, and post to GitHub when you ask. Click to go back to review only."
            : "Work on it yourself: let Claude edit, commit, push, and post to GitHub on this PR as if it were yours."
        }
      >
        {owned ? "🛠 working on it" : "✋ work on it yourself"}
      </button>
      {confirming && (
        <ConfirmCard
          at={confirming}
          message={`${owned ? "Back to review only?" : "Let Claude commit, push, and post?"} Restarts Claude in this conversation.`}
          confirmLabel="switch"
          busyLabel="switching…"
          busy={busy}
          onConfirm={run}
          onCancel={() => setConfirming(null)}
        />
      )}
    </>
  );
}
