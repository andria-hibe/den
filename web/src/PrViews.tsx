import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import { DiffView, DiffHunk, diffFiles } from "./DiffView.tsx";
import { Fox } from "./Fox.tsx";
import { renderMarkdown } from "./markdown.ts";
import { parseReview } from "./reviewNotes.ts";
import { Splitter, clamp } from "./Splitter.tsx";
import { usePersistentNumber, usePersistentString } from "./usePersistent.ts";
import { ToClaude } from "./ToClaude.tsx";
import type { PrDetail, PrReviewNote } from "../../server/github.ts";

function usePrDetail(repo: string, number: number) {
  const [detail, setDetail] = useState<PrDetail | null>(null);
  useEffect(() => {
    api<PrDetail>(`/api/github/pr?repo=${encodeURIComponent(repo)}&number=${number}`)
      .then(setDetail)
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
function notePrompt(prNumber: number, n: PrReviewNote & { kind: string }): string {
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

  const byFile = new Map<string, PrReviewNote[]>();
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

/** Reviewing someone else's PR: one tabbed pane above (the review — general
 * notes then the diff, annotated per file — or the PR description), session
 * below. Two regions, one splitter: it has to work on a small screen. */
export function PrReviewView({
  repo,
  number,
  sessionId,
  groupId,
  autoReview,
  onAutoReviewStarted,
  header,
  terminal,
}: {
  repo: string;
  number: number;
  sessionId: string;
  /** The session's workspace group — the notepad (where the review lands) is
   * keyed by it. Happens to equal sessionId for single-pane review sessions,
   * but that's the server's implementation detail, not ours to rely on. */
  groupId: string;
  autoReview: boolean;
  /** Fired once the auto pre-review has been sent, so it only ever fires once. */
  onAutoReviewStarted?: () => void;
  header: ReactNode;
  terminal: ReactNode;
}) {
  const detail = usePrDetail(repo, number);
  const [diff, setDiff] = useState<string>("");
  const [review, setReview] = useState<string>("");
  // A review has been asked for but hasn't landed in the notepad yet — the only
  // state where a walking fox is honest (an empty notepad on its own just means
  // nobody has asked yet).
  const [requested, setRequested] = useState(false);
  const started = useRef(false);
  const [upperFrac, setUpperFrac] = usePersistentNumber("den.prDiffFrac", 0.6);
  const [tab, setTab] = usePersistentString("den.prReviewTab", "review", [
    "review",
    "description",
  ] as const);
  const rootRef = useRef<HTMLDivElement>(null);

  // The review is filed per file by `## <path>` headings, so each file's
  // comments can sit beside that file's diff; the rest is the general review.
  const files = useMemo(() => diffFiles(diff), [diff]);
  const { overall, byFile } = useMemo(() => parseReview(review, files), [review, files]);

  useEffect(() => {
    api<{ diff: string }>(
      `/api/github/pr/diff?repo=${encodeURIComponent(repo)}&number=${number}`,
    )
      .then((d) => setDiff(d.diff ?? ""))
      .catch(() => {});
  }, [repo, number]);

  // The session writes its finished review to the workspace notepad (see
  // reviewInstruction, server-side); poll it so the review fills in as Claude
  // produces it.
  useEffect(() => {
    let stop = false;
    const load = () =>
      api<{ content: string }>(`/api/notepad/${groupId}`)
        .then((d) => !stop && setReview(d.content ?? ""))
        .catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [groupId]);

  // Have the interactive Claude session (below) do the review, rather than a
  // one-shot headless pass rendered into this pane. The PR is checked out in the
  // session's worktree, so Claude can read the diff + surrounding code, and you
  // can follow up with questions right there. The structure mirrors
  // reviewInstruction (server/sessions.ts) so den can file it per file.
  const reviewPrompt =
    `Please review pull request #${number} (${repo}). The PR's full diff has been ` +
    `saved to a file for you (see your instructions) and the PR is checked out in ` +
    `your working directory — run whatever you need, but don't commit or push, and ` +
    `keep any experiment on the scratch branch named in your instructions. ` +
    `Read the diff, then read the changed files for context. Do the finding pass ` +
    `with the code-review skill as your instructions describe, then write your review ` +
    `to the notepad as markdown in this shape: first the general review (a short ` +
    `**Summary**, then any cross-cutting **Risks**), then one \`## <file path>\` ` +
    `heading per file you have comments on — exact path as it appears in the diff ` +
    `— with your comments on that file as bullets citing line numbers. Skip files ` +
    `you have nothing to say about. If it all looks solid, say so briefly.`;

  // "Have Claude pre-review the diff": send the prompt AND submit it — picking
  // that option means "start the review", so it shouldn't also need an Enter in
  // the session. No client-side delay: the server holds the request until the
  // pane is ready (see the paste route), which a fixed timeout can't get right.
  // onAutoReviewStarted lets App clear its flag, so coming back to this session
  // later doesn't kick off the whole review a second time.
  useEffect(() => {
    if (!autoReview || started.current) return;
    started.current = true;
    setRequested(true);
    api(`/api/sessions/${sessionId}/paste`, {
      method: "POST",
      body: JSON.stringify({ text: reviewPrompt, submit: true }),
    })
      .then(() => onAutoReviewStarted?.())
      .catch(() => setRequested(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReview]);

  return (
    <div className="pr-review" ref={rootRef}>
      <div className="ws-pane pr-info" style={{ flex: `${upperFrac} 1 0` }}>
        <div className="pr-info-head">
          <div className="pr-info-title">{detail?.title ?? `PR #${number}`}</div>
          <div className="ticket-look-tabs" role="tablist">
            <button
              role="tab"
              aria-selected={tab === "review"}
              className={`look-tab${tab === "review" ? " active" : ""}`}
              onClick={() => setTab("review")}
            >
              Review
            </button>
            <button
              role="tab"
              aria-selected={tab === "description"}
              className={`look-tab${tab === "description" ? " active" : ""}`}
              onClick={() => setTab("description")}
            >
              Description
            </button>
          </div>
        </div>
        {tab === "review" ? (
          // One scroll region: the general review, then the diff with each
          // file's comments beside it.
          <div className="pr-review-scroll">
            <div className="pr-review-overall">
              <div className="pr-review-head">
                <h4>den&apos;s review</h4>
                <ToClaude
                  sessionId={sessionId}
                  text={reviewPrompt}
                  label="review in session"
                  title="Ask the Claude session below to review this diff"
                  submit
                  onSent={() => setRequested(true)}
                />
              </div>
              {overall ? (
                <Md text={overall} />
              ) : requested ? (
                <div className="loading-row">
                  <Fox pose="walk" size={22} /> reviewing the diff… the general
                  review lands here, and each file&apos;s comments beside its diff,
                  as Claude writes.
                </div>
              ) : (
                <div className="placeholder">
                  Claude reviews the diff in the session below — click “review in
                  session”, then press Enter. Its general review lands here and
                  its per-file comments beside each file, as it writes.
                </div>
              )}
            </div>
            <DiffView
              diff={diff}
              notes={byFile}
              noteState={review.trim() ? "ready" : requested ? "waiting" : "idle"}
              sessionId={sessionId}
              prNumber={number}
            />
          </div>
        ) : (
          <div className="pr-info-scroll">
            <h4>Description</h4>
            {detail ? (
              <Md text={detail.body || "_(no description)_"} />
            ) : (
              <div className="placeholder">loading…</div>
            )}
          </div>
        )}
      </div>
      <Splitter
        dir="y"
        onDrag={(d) =>
          setUpperFrac((f) => clamp(f + d / (rootRef.current?.clientHeight ?? 1), 0.2, 0.85))
        }
      />
      <div className="ws-main" style={{ flex: `${1 - upperFrac} 1 0` }}>
        {header}
        {terminal}
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
