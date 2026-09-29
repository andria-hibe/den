// The review pane's Guide tab: each section of the reading guide above that
// section's own diffs, with the review's per-file comments still beside each
// file.
import { useMemo } from "react";
import { DiffView, diffForFiles } from "./DiffView.tsx";
import { Fox } from "./Fox.tsx";
import { Md } from "./Md.tsx";
import { churnFromGuide, isChurnPath } from "./churn.ts";
import { parseGuide } from "./reviewGuide.ts";
import { ToClaude } from "./ToClaude.tsx";

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
}) {
  const sub = useMemo(() => diffForFiles(diff, files), [diff, files]);
  const churnSection = churnFromGuide([{ title, files }]).size > 0;
  return (
    <section className="guide-section">
      <div className="guide-section-head">
        <span className="guide-section-num">{index}</span>
        <h5 className="guide-section-title">{title}</h5>
        <span className="guide-section-count">
          {files.length} {files.length === 1 ? "file" : "files"}
        </span>
      </div>
      {body && <Md text={body} />}
      {sub.trim() && (
        <DiffView
          diff={sub}
          notes={notes}
          noteState={noteState}
          sessionId={sessionId}
          prNumber={prNumber}
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
  const { intro, sections, leftover } = useMemo(
    () => parseGuide(guide, files),
    [guide, files],
  );
  const leftoverDiff = useMemo(() => diffForFiles(diff, leftover), [diff, leftover]);

  return (
    <div className="pr-review-scroll">
      <div className="pr-review-overall">
        <div className="pr-review-head">
          <h4>reading guide</h4>
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
          <Md text={intro} />
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
        />
      ))}
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
            startCollapsed={isChurnPath}
          />
        </details>
      )}
    </div>
  );
}
