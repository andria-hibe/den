import { useEffect, useState } from "react";
import { api } from "./api.ts";
import { renderMarkdown } from "./markdown.ts";
import { relTimeAgo } from "./format.ts";
import type { LinearComment } from "../../server/linear.ts";

// Comments on a Linear ticket, shown in the read-only "look" view. Fetches
// lazily per ticket; stays quiet (renders nothing) on error or when empty.
export function TicketComments({ ticketId }: { ticketId: string }) {
  const [comments, setComments] = useState<LinearComment[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setComments(null);
    setFailed(false);
    api<{ comments: LinearComment[] }>(
      `/api/linear/comments?id=${encodeURIComponent(ticketId)}`,
    )
      .then((d) => alive && setComments(d.comments ?? []))
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
            <span className="ticket-comment-time">{relTimeAgo(c.at)}</span>
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
