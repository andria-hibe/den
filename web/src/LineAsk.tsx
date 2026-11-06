import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { renderMarkdown } from "./markdown.ts";
import { ToClaude } from "./ToClaude.tsx";
import { Fox } from "./Fox.tsx";
import { lineAnswerPrompt } from "./prompts.ts";
import type { LineThread, LineThreads } from "../../server/lineAsk.ts";

export const threadKey = (file: string, side: string, line: number) => `${file}:${side}${line}`;

// One copy of a session's line threads, shared by every DiffView showing it
// (the Guide tab draws one per section).
const store = new Map<string, LineThreads>();
const listeners = new Map<string, Set<() => void>>();
const loading = new Set<string>();

function publish(sessionId: string, threads: LineThreads) {
  store.set(sessionId, threads);
  for (const l of listeners.get(sessionId) ?? []) l();
}

export function useLineThreads(sessionId: string | undefined): LineThreads {
  const [, bump] = useState(0);
  useEffect(() => {
    if (!sessionId) return;
    const l = () => bump((n) => n + 1);
    const set = listeners.get(sessionId) ?? new Set();
    set.add(l);
    listeners.set(sessionId, set);
    if (!store.has(sessionId) && !loading.has(sessionId)) {
      loading.add(sessionId);
      api<{ threads: LineThreads }>(`/api/sessions/${sessionId}/line-threads`)
        .then((d) => publish(sessionId, d.threads))
        .catch(() => {})
        .finally(() => loading.delete(sessionId));
    }
    return () => {
      set.delete(l);
    };
  }, [sessionId]);
  return (sessionId && store.get(sessionId)) || {};
}

export interface LineAt {
  file: string;
  side: "old" | "new";
  line: number;
  quote: string;
  hunk: string;
}

/** The questions and answers at one line, with a box to ask (or follow up). */
export function LineThreadView({
  sessionId,
  at,
  thread,
  onClose,
}: {
  sessionId: string;
  at: LineAt;
  thread?: LineThread;
  onClose: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ask = () => {
    const q = question.trim();
    if (!q || asking) return;
    setAsking(q);
    setQuestion("");
    setErr(null);
    api<{ thread: LineThread }>(`/api/sessions/${sessionId}/ask-line`, {
      method: "POST",
      body: JSON.stringify({ ...at, question: q }),
    })
      .then((d) => {
        const key = threadKey(at.file, at.side, at.line);
        publish(sessionId, { ...(store.get(sessionId) ?? {}), [key]: d.thread });
      })
      .catch((e) => {
        setErr((e as Error).message);
        setQuestion(q);
      })
      .finally(() => setAsking(null));
  };
  const transcript = (thread?.messages ?? [])
    .map((m) => `${m.from === "you" ? "Q" : "A"}: ${m.text}`)
    .join("\n");
  return (
    <div className="line-thread">
      {thread?.messages.map((m, i) => (
        <div key={i} className={`line-msg ${m.from}`}>
          {m.from === "you" ? (
            <div className="line-q">{m.text}</div>
          ) : (
            <div className="md line-a" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
          )}
        </div>
      ))}
      {asking && (
        <>
          <div className="line-msg you">
            <div className="line-q">{asking}</div>
          </div>
          <div className="line-thinking">
            <Fox pose="walk" size={16} /> reading the code...
          </div>
        </>
      )}
      {err && <div className="line-err">{err}</div>}
      <div className="line-ask-row">
        <textarea
          className="line-ask-input"
          autoFocus
          rows={1}
          placeholder={thread ? "Follow up..." : "Ask about this line, e.g. why is this here?"}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask();
            } else if (e.key === "Escape") onClose();
          }}
        />
        <button className="btn btn-ghost-outline line-ask-send" disabled={!question.trim() || !!asking} onClick={ask}>
          ask
        </button>
        {thread && (
          <ToClaude
            sessionId={sessionId}
            text={lineAnswerPrompt(at.file, at.line, transcript)}
            label="-> review"
            title="Paste this exchange into the review session"
            className="line-ask-send"
          />
        )}
        <button className="btn-ghost line-ask-close" title="close" onClick={onClose}>
          x
        </button>
      </div>
    </div>
  );
}
