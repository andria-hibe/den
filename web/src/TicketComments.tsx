import { useEffect, useState } from "react";
import { renderMarkdown } from "./markdown.ts";
import type { LinearComment } from "../../server/linear.ts";

function relTime(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// Comments on a Linear ticket, shown in the read-only "look" view. Fetches
// lazily per ticket; stays quiet (renders nothing) on error or when empty.
export function TicketComments({ ticketId }: { ticketId: string }) {
  const [comments, setComments] = useState<LinearComment[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setComments(null);
    setFailed(false);
    fetch(`/api/linear/comments?id=${encodeURIComponent(ticketId)}`)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d.error) setFailed(true);
        else setComments((d.comments ?? []) as LinearComment[]);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [ticketId]);

  if (failed)
    return <div className="ticket-comments-note">Couldn't load comments.</div>;
  if (comments === null)
    return <div className="ticket-comments-note">loading comments…</div>;
  if (comments.length === 0)
    return <div className="ticket-comments-note">No comments yet.</div>;

  return (
    <div className="ticket-comments">
      {comments.map((c, i) => (
        <div className="ticket-comment" key={i}>
          <div className="ticket-comment-meta">
            <strong>{c.author}</strong>
            <span className="ticket-comment-time">{relTime(c.at)}</span>
          </div>
          <div
            className="md"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(c.body) }}
          />
        </div>
      ))}
    </div>
  );
}
