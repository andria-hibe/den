import { useState } from "react";

/** Button that pastes a framed instruction into a session's Claude prompt via
 * bracketed paste (keeps multi-line as one entry, does not auto-submit). Shared
 * by the PR views (comment → Claude) and the diff view (file → targeted review). */
export function ToClaude({
  sessionId,
  text,
  label = "→ Claude",
  title = "Paste this into Claude to action it",
  className = "",
}: {
  sessionId: string;
  text: string;
  label?: string;
  title?: string;
  className?: string;
}) {
  const [sent, setSent] = useState(false);
  const send = () => {
    fetch(`/api/sessions/${sessionId}/paste`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then(() => {
        setSent(true);
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
