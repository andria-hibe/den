// The Review pane's "Guide" tab: the PR read in the order it was written, not
// in file-alphabetical order. The review session writes a reading guide (see
// reviewInstruction, server-side) that groups related changes into sections with
// the purpose and impact of each; this renders each section's prose above that
// section's own diffs, so you meet the core of the implementation first and the
// churn last. The review's per-file comments still sit beside each file, so the
// guide is a complete way to read the change on its own.
import { useMemo } from "react";
import { DiffView, diffForFiles } from "./DiffView.tsx";
import { Fox } from "./Fox.tsx";
import { Md } from "./Md.tsx";
import { parseGuide } from "./reviewGuide.ts";
import { ToClaude } from "./ToClaude.tsx";

/** One guide section: its explanation, then the diffs it groups. */
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
  /** The guide markdown as the session has written it so far. */
  guide: string;
  /** The PR's full unified diff. */
  diff: string;
  /** The paths the diff touches, in diff order (the guide's fallback order). */
  files: string[];
  /** The review's per-file comments, shown beside each file here too. */
  notes?: Record<string, string>;
  noteState: "idle" | "waiting" | "ready";
  sessionId: string;
  prNumber: number;
  /** The paste that asks the session for the guide. */
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
          />
        </details>
      )}
    </div>
  );
}
