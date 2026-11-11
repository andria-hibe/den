// The review pane's Guide tab: each section of the reading guide above that
// section's own diffs, with the review's per-file comments still beside each
// file.
import { useMemo } from "react";
import { DiffView, diffForFiles } from "./DiffView.tsx";
import { Fox } from "./Fox.tsx";
import { Md } from "./Md.tsx";
import { churnFromGuide, isChurnPath } from "../../shared/churn.ts";
import { parseGuide, type GuideNote } from "./reviewGuide.ts";
import { RiskChip } from "./RiskChip.tsx";
import { ToClaude } from "./ToClaude.tsx";
import { usePersistentJson } from "./usePersistent.ts";
import { anchorLine, linesInDiff } from "./reviewPost.ts";
import { renderMarkdown } from "./markdown.ts";

/** Reading time for a section, at about 40 changed lines a minute. */
export function readingMinutes(diff: string): number {
  const changed = diff.split("\n").filter((l) => /^[+-](?![+-]{2} )/.test(l)).length;
  return Math.max(1, Math.round(changed / 40));
}

const noteKey = (n: GuideNote) => `${n.file}:${n.line}:${n.text.slice(0, 40)}`;

function Section({
  index,
  title,
  body,
  files,
  diff,
  notes,
  noteState,
  sessionId,
  prNumber,
  lineNotes,
  read,
  onRead,
}: {
  index: number;
  title: string;
  body: string;
  files: string[];
  diff: string;
  notes?: Record<string, string>;
  noteState: "idle" | "waiting" | "ready";
  sessionId: string;
  prNumber: number;
  lineNotes: GuideNote[];
  read: boolean;
  onRead: () => void;
}) {
  const sub = useMemo(() => diffForFiles(diff, files), [diff, files]);
  const churnSection = churnFromGuide([{ title, files }]).size > 0;
  return (
    <section className={`guide-section${read ? " read" : ""}`}>
      <div className="guide-section-head">
        <span className="guide-section-num">{index}</span>
        <h5 className="guide-section-title">{title}</h5>
        <span className="guide-section-count">
          {files.length} {files.length === 1 ? "file" : "files"} · ~{readingMinutes(sub)} min
        </span>
        <button className={`btn btn-ghost-outline guide-read${read ? " on" : ""}`} onClick={onRead} title="Mark this section as read">
          {read ? "✓ read" : "mark read"}
        </button>
      </div>
      {body && <Md text={body} />}
      {sub.trim() && (
        <DiffView
          diff={sub}
          notes={notes}
          noteState={noteState}
          sessionId={sessionId}
          prNumber={prNumber}
          ask
          guideNotes={lineNotes}
          startCollapsed={(f) => churnSection || isChurnPath(f)}
        />
      )}
    </section>
  );
}

export function PrGuideTab({
  guide,
  diff,
  files,
  notes,
  noteState,
  sessionId,
  prNumber,
  prompt,
  requested,
  onRequested,
}: {
  guide: string;
  diff: string;
  /** The paths the diff touches, in diff order. */
  files: string[];
  notes?: Record<string, string>;
  noteState: "idle" | "waiting" | "ready";
  sessionId: string;
  prNumber: number;
  prompt: string;
  /** A guide has been asked for but hasn't landed yet — the only state where a
   * walking fox is honest (see the review tab's `requested`). */
  requested: boolean;
  onRequested: () => void;
}) {
  const parsed = useMemo(() => parseGuide(guide, files), [guide, files]);
  const { intro, risk, leftover, twice, unknown } = parsed;
  // A note's line number is a guess; the code it quotes, when it quotes some,
  // says where it really is (as when the review is posted).
  const sections = useMemo(
    () =>
      parsed.sections.map((s) => ({
        ...s,
        notes: s.notes.map((n) => ({ ...n, line: anchorLine(`${n.file}:${n.line} ${n.text}`, linesInDiff(diff, n.file)) ?? n.line })),
      })),
    [parsed, diff],
  );
  // Reading progress and the wrap-up ticks, kept per review session.
  const [readSections, setReadSections] = usePersistentJson<string[]>(`den.guideRead.${sessionId}`, []);
  const [ticked, setTicked] = usePersistentJson<string[]>(`den.guideTicks.${sessionId}`, []);
  const toggleIn = (list: string[], key: string) => (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const wrapUp = sections.flatMap((s) => s.notes).filter((n) => n.tone !== "explains");
  const coverage = [
    leftover.length && sections.length ? `${leftover.length} ${leftover.length === 1 ? "file" : "files"} not in the guide` : null,
    twice.length ? `${twice.length} named twice` : null,
    unknown.length ? `${unknown.length} unknown ${unknown.length === 1 ? "path" : "paths"}` : null,
  ].filter(Boolean);
  const leftoverDiff = useMemo(() => diffForFiles(diff, leftover), [diff, leftover]);

  return (
    <div className="pr-review-scroll">
      <div className="pr-review-overall">
        <div className="pr-review-head">
          <h4>reading guide</h4>
          {risk && <RiskChip risk={risk} />}
          <ToClaude
            sessionId={sessionId}
            text={prompt}
            label="build guide"
            title="Ask the Claude session below to group this PR's changes into a reading guide"
            submit
            onSent={onRequested}
          />
        </div>
        {intro ? (
          <>
            <Md text={intro} />
            {sections.length > 0 && (
              <div className="guide-coverage" title={[...twice, ...unknown].join("\n") || undefined}>
                {readSections.filter((t) => sections.some((s) => s.title === t)).length} of {sections.length} sections read
                {coverage.length ? ` · ${coverage.join(" · ")}` : " · every file is in the guide"}
              </div>
            )}
          </>
        ) : requested ? (
          <div className="loading-row">
            <Fox pose="walk" size={22} /> grouping the changes… each section lands
            here with its diffs as Claude writes.
          </div>
        ) : (
          <div className="placeholder">
            Claude groups this PR into sections — core implementation first,
            churn last — each explained above its own diffs. Click “build guide”.
            Until then the whole diff is below, in file order.
          </div>
        )}
      </div>
      {sections.map((s, i) => (
        <Section
          key={`${i}:${s.title}`}
          index={i + 1}
          title={s.title}
          body={s.body}
          files={s.files}
          diff={diff}
          notes={notes}
          noteState={noteState}
          sessionId={sessionId}
          prNumber={prNumber}
          lineNotes={s.notes}
          read={readSections.includes(s.title)}
          onRead={() => setReadSections((r) => toggleIn(r, s.title))}
        />
      ))}
      {wrapUp.length > 0 && (
        <section className="guide-section guide-wrapup">
          <div className="guide-section-head">
            <h5 className="guide-section-title">Before you post</h5>
            <span className="guide-section-count">
              {wrapUp.filter((n) => ticked.includes(noteKey(n))).length} of {wrapUp.length} looked at
            </span>
          </div>
          {wrapUp.map((n) => (
            <label key={noteKey(n)} className="guide-wrapup-item">
              <input type="checkbox" checked={ticked.includes(noteKey(n))} onChange={() => setTicked((t) => toggleIn(t, noteKey(n)))} />
              <span className={`guide-mark-tone ${n.tone.replace(" ", "-")}`}>{n.tone}</span>
              <code title={n.file}>
                {n.file.split("/").slice(-2).join("/")}:{n.line}
              </code>{" "}
              <span className="md-inline" dangerouslySetInnerHTML={{ __html: renderMarkdown(n.text) }} />
            </label>
          ))}
        </section>
      )}
      {leftoverDiff.trim() && (
        // Collapsed: either the guide left these out on purpose (churn it never
        // named) or there's no guide yet, in which case this is the whole diff.
        <details className="guide-leftover">
          <summary>
            {sections.length > 0
              ? `${leftover.length} ${leftover.length === 1 ? "file" : "files"} the guide doesn't group`
              : `the whole diff, in file order (${leftover.length} ${leftover.length === 1 ? "file" : "files"})`}
          </summary>
          <DiffView
            diff={leftoverDiff}
            notes={notes}
            noteState={noteState}
            sessionId={sessionId}
            prNumber={prNumber}
            ask
            startCollapsed={isChurnPath}
          />
        </details>
      )}
    </div>
  );
}
