import { useState } from "react";
import { api } from "./api.ts";
import { Md } from "./Md.tsx";
import { isAscii } from "../../shared/ascii.ts";
import type { ReviewPost } from "./reviewPost.ts";
import type { PrReviewNote, ReviewEvent } from "../../server/github.ts";

// Posting to GitHub from den (#16). Nothing here posts on its own: each action
// shows what goes, and posts only on the developer's click. Den's server makes
// the call, never a review session (whose permissions deny every gh write).

/** Characters that won't survive a paste into GitHub (see shared/ascii.ts). */
function nonAscii(text: string): number {
  return [...text].filter((ch) => !isAscii(ch)).length;
}

export function PostReviewDialog({
  repo,
  number,
  post,
  onClose,
}: {
  repo: string;
  number: number;
  post: ReviewPost;
  onClose: () => void;
}) {
  const [body, setBody] = useState(post.body);
  const [event, setEvent] = useState<ReviewEvent>("COMMENT");
  const [state, setState] = useState<{ busy?: boolean; error?: string; url?: string }>({});
  const odd = nonAscii(body) + post.comments.reduce((n, c) => n + nonAscii(c.body), 0);

  const submit = async () => {
    setState({ busy: true });
    try {
      const r = await api<{ url: string }>("/api/github/pr/review-submit", {
        method: "POST",
        body: JSON.stringify({ repo, number, event, body, comments: post.comments }),
      });
      setState({ url: r.url || `https://github.com/${repo}/pull/${number}` });
    } catch (e) {
      setState({ error: (e as Error).message });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal post-review" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>Post review to GitHub · #{number}</strong>
          <button className="btn-ghost" onClick={onClose} title="cancel">
            ×
          </button>
        </div>
        {state.url ? (
          <div className="post-done">
            Posted.{" "}
            <a href={state.url} target="_blank" rel="noreferrer">
              open on GitHub ↗
            </a>
          </div>
        ) : (
          <>
            <div className="post-scroll">
              <div className="post-label">review body</div>
              <textarea
                className="notepad-body post-body"
                value={body}
                spellCheck={false}
                onChange={(e) => setBody(e.target.value)}
              />
              <div className="post-label">
                {post.comments.length} inline comment{post.comments.length === 1 ? "" : "s"}
                {post.comments.length > 0 && " (bullets whose line is in the diff)"}
              </div>
              {post.comments.map((c, i) => (
                <div key={i} className="post-comment">
                  <code>
                    {c.path}:{c.line}
                  </code>
                  <Md text={c.body} />
                </div>
              ))}
            </div>
            {odd > 0 && (
              <div className="wt-loss risky">
                {odd} non-ASCII character{odd === 1 ? "" : "s"} (em dash, curly quote, arrow...) will
                reach GitHub as they are.
              </div>
            )}
            {state.error && <div className="wt-loss risky">{state.error}</div>}
            <div className="modal-foot">
              <select value={event} onChange={(e) => setEvent(e.target.value as ReviewEvent)}>
                <option value="COMMENT">comment</option>
                <option value="REQUEST_CHANGES">request changes</option>
                <option value="APPROVE">approve</option>
              </select>
              <button className="btn btn-primary" onClick={submit} disabled={state.busy}>
                {state.busy ? "posting…" : "post to GitHub"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Reply to and resolve one inline thread on your own PR. Sits under the
 * thread's last comment. */
export function ThreadActions({
  repo,
  number,
  note,
  onChanged,
}: {
  repo: string;
  number: number;
  /** Any comment of the thread; carries its threadId and replyTo. */
  note: PrReviewNote;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "reply" | "resolve">("idle");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const odd = nonAscii(text);

  const run = async (path: string, payload: object) => {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body: JSON.stringify(payload) });
      setMode("idle");
      setText("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="thread-actions">
      {mode === "reply" ? (
        <>
          <textarea
            className="notepad-body thread-reply"
            value={text}
            autoFocus
            placeholder="Reply on GitHub…"
            onChange={(e) => setText(e.target.value)}
          />
          {odd > 0 && (
            <div className="wt-loss risky">
              {odd} non-ASCII character{odd === 1 ? "" : "s"} will reach GitHub as they are.
            </div>
          )}
          <div className="thread-buttons">
            <button
              className="btn btn-primary"
              disabled={busy || !text.trim() || !note.replyTo}
              onClick={() => run("/api/github/pr/reply", { repo, number, commentId: note.replyTo, body: text })}
            >
              {busy ? "posting…" : "post reply"}
            </button>
            <button className="btn" onClick={() => setMode("idle")} disabled={busy}>
              cancel
            </button>
          </div>
        </>
      ) : mode === "resolve" ? (
        <div className="thread-buttons">
          <span>Resolve this thread on GitHub?</span>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={() => run("/api/github/pr/resolve", { threadId: note.threadId })}
          >
            {busy ? "resolving…" : "resolve"}
          </button>
          <button className="btn" onClick={() => setMode("idle")} disabled={busy}>
            cancel
          </button>
        </div>
      ) : (
        <div className="thread-buttons">
          {note.replyTo && (
            <button className="btn btn-ghost-outline" onClick={() => setMode("reply")}>
              ↩ reply
            </button>
          )}
          {note.threadId && (
            <button className="btn btn-ghost-outline" onClick={() => setMode("resolve")}>
              ✓ resolve
            </button>
          )}
        </div>
      )}
      {error && <div className="wt-loss risky">{error}</div>}
    </div>
  );
}
