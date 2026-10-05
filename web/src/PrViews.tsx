import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api.ts";
import { DiffView, DiffHunk, diffFiles } from "./DiffView.tsx";
import { Fox } from "./Fox.tsx";
import { Md } from "./Md.tsx";
import { PrGuideTab } from "./PrGuide.tsx";
import { parseReview } from "./reviewNotes.ts";
import { Splitter, clamp } from "./Splitter.tsx";
import { usePersistentNumber, usePersistentString } from "./usePersistent.ts";
import { ToClaude } from "./ToClaude.tsx";
import { PostReviewDialog, ThreadActions } from "./GitHubPost.tsx";
import { buildReviewPost } from "./reviewPost.ts";
import { churnFromGuide, isChurnPath } from "./churn.ts";
import { parseGuide } from "./reviewGuide.ts";
import { autoReviewPrompt, guidePrompt, notePrompt, reviewPrompt } from "./prompts.ts";
import type { PrDetail, PrReviewNote } from "../../server/github.ts";

function usePrDetail(repo: string, number: number) {
  const [detail, setDetail] = useState<PrDetail | null>(null);
  // Bumped after den posts a reply or resolves a thread, to show the result.
  const [version, setVersion] = useState(0);
  useEffect(() => {
    api<PrDetail>(`/api/github/pr?repo=${encodeURIComponent(repo)}&number=${number}`)
      .then(setDetail)
      .catch(() => {});
  }, [repo, number, version]);
  return { detail, reload: () => setVersion((v) => v + 1) };
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

/** Inline review comments grouped by file, each with the code it points at. */
function InlineComments({
  detail,
  sessionId,
  onChanged,
}: {
  detail: PrDetail;
  sessionId: string;
  /** Refetch after a reply or a resolve posted from here. */
  onChanged: () => void;
}) {
  // Resolved threads start hidden so the tab shows what still needs action.
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
                {/* Under a thread's last comment: reply to it, or resolve it. */}
                {!n.resolved && notes[i + 1]?.threadId !== n.threadId && (
                  <ThreadActions repo={detail.repo} number={detail.number} note={n} onChanged={onChanged} />
                )}
              </div>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/** Reviewing someone else's PR: a tabbed pane (guide, review, description)
 * above the session. Two regions, one splitter, so it fits a small screen. */
export function PrReviewView({
  repo,
  number,
  sessionId,
  groupId,
  owned,
  autoReview,
  onAutoReviewStarted,
  header,
  terminal,
}: {
  repo: string;
  number: number;
  sessionId: string;
  /** Keys the notepad the review lands in. Don't assume it equals sessionId. */
  groupId: string;
  /** The developer has taken the PR on (see OwnPrToggle). */
  owned: boolean;
  /** Start on its own when the view opens: the full pre-review, or the
   * reading guide only. Null: wait to be asked. */
  autoReview: "full" | "guide" | null;
  /** Fired once the auto pre-review is sent, so App can stop it re-firing. */
  onAutoReviewStarted?: () => void;
  header: ReactNode;
  terminal: ReactNode;
}) {
  const { detail } = usePrDetail(repo, number);
  const [diff, setDiff] = useState<string>("");
  const [review, setReview] = useState<string>("");
  const [guide, setGuide] = useState<string>("");
  // Asked for but not landed yet: the only state where a walking fox is
  // honest, since an empty notepad usually means nobody asked. The guide has its
  // own flag because either can be asked for alone.
  const [requested, setRequested] = useState(false);
  const [guideRequested, setGuideRequested] = useState(false);
  const started = useRef(false);
  const [upperFrac, setUpperFrac] = usePersistentNumber("den.prDiffFrac", 0.6);
  const [tab, setTab] = usePersistentString("den.prReviewTab", "guide", [
    "guide",
    "review",
    "description",
  ] as const);
  const rootRef = useRef<HTMLDivElement>(null);
  // The post-to-GitHub preview (#16).
  const [posting, setPosting] = useState(false);

  const files = useMemo(() => diffFiles(diff), [diff]);
  const { overall, byFile } = useMemo(() => parseReview(review, files), [review, files]);
  const guideChurn = useMemo(() => churnFromGuide(parseGuide(guide, files).sections), [guide, files]);
  const startCollapsed = (f: string) => isChurnPath(f) || guideChurn.has(f);
  // Both tabs render the notes column, so they share this state.
  const noteState = review.trim() ? "ready" : requested ? "waiting" : "idle";

  useEffect(() => {
    api<{ diff: string }>(
      `/api/github/pr/diff?repo=${encodeURIComponent(repo)}&number=${number}`,
    )
      .then((d) => setDiff(d.diff ?? ""))
      .catch(() => {});
  }, [repo, number]);

  // Poll the review and the guide on one timer, so each fills in as it's written.
  useEffect(() => {
    let stop = false;
    const load = () => {
      api<{ content: string }>(`/api/notepad/${groupId}`)
        .then((d) => !stop && setReview(d.content ?? ""))
        .catch(() => {});
      api<{ content: string }>(`/api/review/guide/${groupId}`)
        .then((d) => !stop && setGuide(d.content ?? ""))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [groupId]);

  const guideAsk = guidePrompt(number, repo);
  const reviewAsk = reviewPrompt(number, repo, owned);

  // Submitted, not just pasted: choosing a pre-review means "start now". No
  // client-side delay, since the server holds the paste until the pane is ready.
  const autoAsk = autoReview === "guide" ? guideAsk : autoReviewPrompt(number, repo, owned);

  useEffect(() => {
    if (!autoReview || started.current) return;
    started.current = true;
    if (autoReview === "full") setRequested(true);
    setGuideRequested(true);
    api(`/api/sessions/${sessionId}/paste`, {
      method: "POST",
      body: JSON.stringify({ text: autoAsk, submit: true }),
    })
      .then(() => onAutoReviewStarted?.())
      .catch(() => {
        setRequested(false);
        setGuideRequested(false);
      });
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
              aria-selected={tab === "guide"}
              className={`look-tab${tab === "guide" ? " active" : ""}`}
              onClick={() => setTab("guide")}
              title="The change grouped into sections, each explained above its own diffs"
            >
              Guide
            </button>
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
        {tab === "guide" ? (
          <PrGuideTab
            guide={guide}
            diff={diff}
            files={files}
            notes={byFile}
            noteState={noteState}
            sessionId={sessionId}
            prNumber={number}
            prompt={guideAsk}
            requested={guideRequested}
            onRequested={() => setGuideRequested(true)}
          />
        ) : tab === "review" ? (
          <div className="pr-review-scroll">
            <div className="pr-review-overall">
              <div className="pr-review-head">
                <h4>den&apos;s review</h4>
                <ToClaude
                  sessionId={sessionId}
                  text={reviewAsk}
                  label="review in session"
                  title="Ask the Claude session below to review this diff"
                  submit
                  onSent={() => setRequested(true)}
                />
                {review.trim() && (
                  <button
                    className="btn btn-ghost-outline"
                    onClick={() => setPosting(true)}
                    title="Preview the review as a GitHub review (inline comments on diff lines, the rest in the body) and post it"
                  >
                    post to GitHub…
                  </button>
                )}
              </div>
              {posting && (
                <PostReviewDialog
                  repo={repo}
                  number={number}
                  post={buildReviewPost(overall, byFile, diff)}
                  onClose={() => setPosting(false)}
                />
              )}
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
              noteState={noteState}
              sessionId={sessionId}
              prNumber={number}
              startCollapsed={startCollapsed}
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
  const { detail, reload } = usePrDetail(repo, number);
  const [infoFrac, setInfoFrac] = usePersistentNumber("den.myPrFrac", 0.42);
  // Persisted because the my-PR view remounts on every session switch.
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
            <InlineComments detail={detail} sessionId={sessionId} onChanged={reload} />
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
