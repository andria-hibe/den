import { useState } from "react";

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
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      await onSwitch(!owned);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };

  if (confirming) {
    return (
      <span className="own-pr-confirm">
        {owned ? "Back to review only?" : "Let Claude commit, push, and post?"} Restarts Claude in this conversation.
        <button className="btn btn-primary own-pr-btn" disabled={busy} onClick={run}>
          {busy ? "switching…" : "switch"}
        </button>
        <button className="btn own-pr-btn" disabled={busy} onClick={() => setConfirming(false)}>
          cancel
        </button>
      </span>
    );
  }

  return (
    <button
      className={`btn btn-ghost-outline own-pr-btn${owned ? " on" : ""}`}
      disabled={busy}
      onClick={() => (running ? setConfirming(true) : run())}
      title={
        owned
          ? "Claude is working on this PR as yours: it can edit, commit, push, and post to GitHub when you ask. Click to go back to review only."
          : "Work on it yourself: let Claude edit, commit, push, and post to GitHub on this PR as if it were yours."
      }
    >
      {owned ? "🛠 working on it" : "✋ work on it yourself"}
    </button>
  );
}
