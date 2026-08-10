import { useEffect, useRef, useState, type ReactNode } from "react";
import { DiffView, DiffHunk } from "./DiffView.tsx";
import { renderMarkdown } from "./markdown.ts";
import { Splitter, usePersistentNumber, usePersistentString, clamp } from "./Splitter.tsx";
import { ToClaude } from "./ToClaude.tsx";

interface PrNote {
  author: string;
  state?: string;
  body: string;
  at: string;
  path?: string;
  line?: number;
  diffHunk?: string;
  resolved?: boolean;
  outdated?: boolean;
}
interface PrDetail {
  number: number;
  title: string;
  url: string;
  body: string;
  reviews: PrNote[];
  comments: PrNote[];
  reviewComments: PrNote[];
}

function usePrDetail(repo: string, number: number) {
  const [detail, setDetail] = useState<PrDetail | null>(null);
  useEffect(() => {
    fetch(`/api/github/pr?repo=${encodeURIComponent(repo)}&number=${number}`)
      .then((r) => r.json())
      .then((d) => !d.error && setDetail(d))
      .catch(() => {});
  }, [repo, number]);
  return detail;
}

function Md({ text }: { text: string }) {
  return (
    <div className="md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
  );
}

/** Build the prompt Claude receives when actioning a comment. */
function notePrompt(prNumber: number, n: PrNote & { kind: string }): string {
  const where = n.path
    ? ` on \`${n.path}\`${n.line ? ` (line ${n.line})` : ""}`
    : "";
  const hunk = n.diffHunk ? `\n\nRelevant diff:\n\`\`\`diff\n${n.diffHunk}\n\`\`\`` : "";
  return (
    `Please action this ${n.kind.replace(/_/g, " ").toLowerCase()} from ` +
    `@${n.author}${where} on PR #${prNumber}:\n\n"${n.body}"${hunk}`
  );
}

/** Top-level reviews and issue comments (no code anchor). */
function Notes({ detail, sessionId }: { detail: PrDetail; sessionId: string }) {
  const notes = [
    ...detail.reviews.map((r) => ({ ...r, kind: r.state || "review" })),
    ...detail.comments.map((c) => ({ ...c, kind: "comment" })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  if (notes.length === 0)
    return <div className="placeholder">No reviews or comments yet.</div>;
  return (
    <div className="pr-notes">
      {notes.map((n, i) => (
        <div key={i} className="pr-note">
          <div className="pr-note-head">
            <strong>{n.author}</strong>
            <span className={`pr-note-kind ${n.kind.replace(/\s+/g, "-").toLowerCase()}`}>
              {n.kind.replace(/_/g, " ").toLowerCase()}
            </span>
            {n.body && (
              <ToClaude
                sessionId={sessionId}
                text={notePrompt(detail.number, { ...n, kind: n.kind })}
              />
            )}
          </div>
          {n.body && <Md text={n.body} />}
        </div>
      ))}
    </div>
  );
}

/** Inline, line-level review comments shown with the code they point at,
 * grouped by file — a comment-focused diff view. */
function InlineComments({
  detail,
  sessionId,
}: {
  detail: PrDetail;
  sessionId: string;
}) {
  // Resolved threads are hidden by default so the tab shows what still needs
  // action; a toggle reveals them (dimmed, badged) so nothing is lost.
  const [showResolved, setShowResolved] = useState(false);
  const all = detail.reviewComments;
  if (all.length === 0)
    return <div className="placeholder">No inline comments.</div>;
  const resolvedCount = all.filter((c) => c.resolved).length;
  const shown = showResolved ? all : all.filter((c) => !c.resolved);

  const byFile = new Map<string, PrNote[]>();
  for (const c of shown) {
    const key = c.path ?? "(general)";
    (byFile.get(key) ?? byFile.set(key, []).get(key)!).push(c);
  }

  return (
    <div className="pr-inline-files">
      {resolvedCount > 0 && (
        <button
          className="btn resolved-toggle"
          onClick={() => setShowResolved((v) => !v)}
        >
          {showResolved
            ? `hide ${resolvedCount} resolved`
            : `show ${resolvedCount} resolved`}
        </button>
      )}
      {shown.length === 0 ? (
        <div className="placeholder">All inline comments resolved 🎉</div>
      ) : (
        [...byFile.entries()].map(([file, notes]) => (
          <div key={file} className="pr-inline-file">
            <div className="pr-inline-filename" title={file}>
              {file}
            </div>
            {notes.map((n, i) => (
              <div
                key={i}
                className={`pr-inline-comment${n.resolved ? " resolved" : ""}`}
              >
                {n.diffHunk && <DiffHunk hunk={n.diffHunk} />}
                <div className="pr-note-head">
                  <strong>{n.author}</strong>
                  {n.line ? (
                    <span className="pr-note-loc">line {n.line}</span>
                  ) : null}
                  {n.resolved && (
                    <span className="pr-note-resolved" title="thread resolved">
                      resolved
                    </span>
                  )}
                  <ToClaude
                    sessionId={sessionId}
                    text={notePrompt(detail.number, { ...n, kind: "line comment" })}
                  />
                </div>
                {n.body && <Md text={n.body} />}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/** Reviewing someone else's PR: diff on top, session + description/review below. */
export function PrReviewView({
  repo,
  number,
  sessionId,
  autoReview,
  header,
  terminal,
}: {
  repo: string;
  number: number;
  sessionId: string;
  autoReview: boolean;
  header: ReactNode;
  terminal: ReactNode;
}) {
  const detail = usePrDetail(repo, number);
  const [diff, setDiff] = useState<string>("");
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [loadingSummaries, setLoadingSummaries] = useState(true);
  const [review, setReview] = useState<string>("");
  const started = useRef(false);
  const [diffFrac, setDiffFrac] = usePersistentNumber("den.prDiffFrac", 0.55);
  const [reviewFrac, setReviewFrac] = usePersistentNumber("den.prReviewFrac", 0.62);
  const [sessFrac, setSessFrac] = usePersistentNumber("den.prSessFrac", 0.55);
  const rootRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/github/pr/diff?repo=${encodeURIComponent(repo)}&number=${number}`)
      .then((r) => r.json())
      .then((d) => !d.error && setDiff(d.diff ?? ""))
      .catch(() => {});
  }, [repo, number]);

  // The session writes its finished review to the workspace notepad (see
  // reviewInstruction, server-side); poll it so the review column fills in as
  // Claude produces it. sessionId === groupId for single-pane review panes.
  useEffect(() => {
    let stop = false;
    const load = () =>
      fetch(`/api/notepad/${sessionId}`)
        .then((r) => r.json())
        .then((d) => !stop && setReview(d.content ?? ""))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [sessionId]);

  // Per-file summaries for the side column (headless Claude — takes a bit).
  useEffect(() => {
    setLoadingSummaries(true);
    fetch("/api/github/pr/diff-summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo, number }),
    })
      .then((r) => r.json())
      .then((d) => {
        const map: Record<string, string> = {};
        for (const s of d.summaries ?? []) map[s.file] = s.summary;
        setSummaries(map);
      })
      .catch(() => {})
      .finally(() => setLoadingSummaries(false));
  }, [repo, number]);

  // Have the interactive Claude session (bottom-left) do the review, rather than
  // a one-shot headless pass rendered into this pane. The PR is checked out in
  // the session's worktree, so Claude can read the diff + surrounding code, and
  // you can follow up with questions right there.
  const reviewPrompt =
    `Please review pull request #${number} (${repo}). This is a read-only review ` +
    `session with no shell — the PR's full diff has been saved to a file for you ` +
    `(see your instructions) and the PR is checked out in your working directory. ` +
    `Read the diff, then read the changed files for context, and give a concise, ` +
    `skimmable code review in markdown with sections: **Summary**, **Potential ` +
    `bugs**, **Risky changes**, **Suggestions**. Reference specific files and ` +
    `lines. If it looks solid, say so briefly.`;

  // "Pre-review the diff": prime the session with the prompt once, shortly after
  // mount so Claude has a moment to be ready. Like the → Claude buttons, the
  // paste doesn't auto-submit — press Enter in the session to run it.
  useEffect(() => {
    if (!autoReview || started.current) return;
    started.current = true;
    const t = setTimeout(() => {
      fetch(`/api/sessions/${sessionId}/paste`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: reviewPrompt }),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReview]);

  return (
    <div className="pr-review" ref={rootRef}>
      <div className="pr-top-split" ref={topRef} style={{ flex: `${diffFrac} 1 0` }}>
        <div className="pr-diff-wrap" style={{ flex: `${reviewFrac} 1 0` }}>
          <DiffView
            diff={diff}
            summaries={summaries}
            loadingSummaries={loadingSummaries}
            sessionId={sessionId}
            prNumber={number}
          />
        </div>
        <Splitter
          dir="x"
          onDrag={(d) =>
            setReviewFrac((f) =>
              clamp(f + d / (topRef.current?.clientWidth ?? 1), 0.3, 0.85),
            )
          }
        />
        <div className="pr-review-col" style={{ flex: `${1 - reviewFrac} 1 0` }}>
          <div className="pr-review-head">
            <h4>den&apos;s review</h4>
            <ToClaude
              sessionId={sessionId}
              text={reviewPrompt}
              label="review in session"
              title="Ask the Claude session below to review this diff"
            />
          </div>
          <div className="pr-review-body">
            {review.trim() ? (
              <Md text={review} />
            ) : (
              <div className="placeholder">
                Claude reviews the diff in the session below — click “review in
                session”, then press Enter. Its review shows up here (and is saved
                to the progress notepad) as it writes.
              </div>
            )}
          </div>
        </div>
      </div>
      <Splitter
        dir="y"
        onDrag={(d) =>
          setDiffFrac((f) => clamp(f + d / (rootRef.current?.clientHeight ?? 1), 0.2, 0.8))
        }
      />
      <div className="pr-bottom" ref={bottomRef} style={{ flex: `${1 - diffFrac} 1 0` }}>
        <div className="ws-main" style={{ flex: `${sessFrac} 1 0` }}>
          {header}
          {terminal}
        </div>
        <Splitter
          dir="x"
          onDrag={(d) =>
            setSessFrac((f) => clamp(f + d / (bottomRef.current?.clientWidth ?? 1), 0.25, 0.8))
          }
        />
        <div className="ws-pane pr-info" style={{ flex: `${1 - sessFrac} 1 0` }}>
          <div className="pr-info-scroll">
            <div className="pr-info-title">
              {detail?.title ?? `PR #${number}`}
            </div>
            <h4>Description</h4>
            {detail ? <Md text={detail.body || "_(no description)_"} /> : <div className="placeholder">loading…</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Your own PR: description + colleagues' reviews/comments on top, session below. */
export function PrMyView({
  repo,
  number,
  sessionId,
  header,
  terminal,
}: {
  repo: string;
  number: number;
  sessionId: string;
  header: ReactNode;
  terminal: ReactNode;
}) {
  const detail = usePrDetail(repo, number);
  const [infoFrac, setInfoFrac] = usePersistentNumber("den.myPrFrac", 0.42);
  // Remembered across session switches + restarts (my-PR view is keyed-remounted).
  const [tab, setTab] = usePersistentString("den.myPrTab", "overview", [
    "overview",
    "inline",
  ] as const);
  const rootRef = useRef<HTMLDivElement>(null);
  const inlineCount = detail?.reviewComments.length ?? 0;

  return (
    <div className="pr-my" ref={rootRef}>
      <div className="ws-pane pr-info" style={{ flex: `${infoFrac} 1 0` }}>
        <div className="pr-info-head">
          <div className="pr-info-title">{detail?.title ?? `PR #${number}`}</div>
          <div className="ticket-look-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "overview"}
              className={`look-tab${tab === "overview" ? " active" : ""}`}
              onClick={() => setTab("overview")}
            >
              Description &amp; comments
            </button>
            <button
              role="tab"
              aria-selected={tab === "inline"}
              className={`look-tab${tab === "inline" ? " active" : ""}`}
              onClick={() => setTab("inline")}
            >
              Inline comments{inlineCount ? ` (${inlineCount})` : ""}
            </button>
          </div>
        </div>
        <div className="pr-info-scroll">
          {!detail ? (
            <div className="placeholder">loading…</div>
          ) : tab === "overview" ? (
            <>
              <h4>Description</h4>
              <Md text={detail.body || "_(no description)_"} />
              <hr />
              <h4>Reviews &amp; comments</h4>
              <Notes detail={detail} sessionId={sessionId} />
            </>
          ) : (
            <InlineComments detail={detail} sessionId={sessionId} />
          )}
        </div>
      </div>
      <Splitter
        dir="y"
        onDrag={(d) =>
          setInfoFrac((f) => clamp(f + d / (rootRef.current?.clientHeight ?? 1), 0.15, 0.8))
        }
      />
      <div className="ws-main" style={{ flex: `${1 - infoFrac} 1 0` }}>
        {header}
        {terminal}
      </div>
    </div>
  );
}
