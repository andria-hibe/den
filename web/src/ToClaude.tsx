import { useState } from "react";
import { api } from "./api.ts";

/** Button that pastes a framed instruction into a session's Claude prompt via
 * bracketed paste (keeps multi-line as one entry, does not auto-submit). Shared
 * by the PR views (comment → Claude) and the diff view (file → targeted review). */
export function ToClaude({
  sessionId,
  text,
  label = "→ Claude",
  title = "Paste this into Claude to action it",
  className = "",
  onSent,
  submit = false,
}: {
  sessionId: string;
  text: string;
  label?: string;
  title?: string;
  className?: string;
  /** Fired once the paste lands — lets the caller show a "working on it" state. */
  onSent?: () => void;
  /** Press Enter for the user too. For buttons that mean "do this now" (the
   * review); the comment buttons leave it off so you can read before sending. */
  submit?: boolean;
}) {
  const [sent, setSent] = useState(false);
  const send = () => {
    api(`/api/sessions/${sessionId}/paste`, {
      method: "POST",
      body: JSON.stringify({ text, submit }),
    })
      .then(() => {
        setSent(true);
        onSent?.();
        setTimeout(() => setSent(false), 2000);
      })
      .catch(() => {});
  };
  return (
    <button
      className={`btn to-claude${className ? ` ${className}` : ""}`}
      onClick={send}
      title={title}
    >
      {sent ? "✓ sent to Claude" : label}
    </button>
  );
}
