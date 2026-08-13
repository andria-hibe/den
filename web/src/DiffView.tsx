// Renders a unified diff (from `gh pr diff`) grouped per file, with a left
// column holding the review's comments for that file, aligned to (and sticky
// alongside) the file's block — so the review reads next to the code it's about.
import { renderMarkdown } from "./markdown.ts";
import { ToClaude } from "./ToClaude.tsx";

interface FileBlock {
  file: string | null;
  lines: string[];
}

/** Prompt Claude receives when asked for a targeted review of one file's diff. */
function fileReviewPrompt(file: string, prNumber: number | undefined, lines: string[]): string {
  const where = prNumber ? ` from PR #${prNumber}` : "";
  return (
    `Please give me a targeted review of the changes to \`${file}\`${where}. ` +
    `Call out bugs, edge cases, and anything risky.\n\n` +
    `\`\`\`diff\n${lines.join("\n")}\n\`\`\``
  );
}

export function classify(line: string): string {
  if (line.startsWith("diff --git")) return "diff-file";
  if (
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("new file") ||
    line.startsWith("deleted file") ||
    line.startsWith("similarity ") ||
    line.startsWith("rename ")
  )
    return "diff-meta";
  if (line.startsWith("@@")) return "diff-hunk";
  if (line.startsWith("+")) return "diff-add";
  if (line.startsWith("-")) return "diff-del";
  return "diff-ctx";
}

/** Old/new file line numbers for one diff line; `null` where the line has none
 * (headers, hunk markers, and the added/removed side of a change). */
export interface LineNos {
  old: number | null;
  new: number | null;
}

const NO_NOS: LineNos = { old: null, new: null };
const HUNK_HEADER = /^@@+ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Walk a unified diff's lines and number them the way the file itself is
 * numbered, so a review saying "line 448" can be found in the diff. Counters
 * come from each `@@ -old +new @@` header; anything outside a hunk (the
 * `diff --git`/`index`/`---`/`+++` preamble) is unnumbered — note those meta
 * lines also start with `-`/`+`, which is why numbering only runs inside a hunk. */
export function lineNumbers(lines: string[]): LineNos[] {
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  return lines.map((line) => {
    const m = HUNK_HEADER.exec(line);
    if (m) {
      oldNo = Number(m[1]);
      newNo = Number(m[2]);
      inHunk = true;
      return NO_NOS;
    }
    if (line.startsWith("diff --git")) inHunk = false;
    if (!inHunk) return NO_NOS;
    // "\ No newline at end of file" annotates the previous line, it isn't one.
    if (line.startsWith("\\")) return NO_NOS;
    if (line.startsWith("+")) return { old: null, new: newNo++ };
    if (line.startsWith("-")) return { old: oldNo++, new: null };
    return { old: oldNo++, new: newNo++ };
  });
}

/** One diff line: the two number gutters, then the text. */
function DiffLine({
  line,
  nos,
  className,
}: {
  line: string;
  nos: LineNos;
  className: string;
}) {
  return (
    <div className={className}>
      <span className="diff-gutter" aria-hidden="true">
        <span className="diff-num">{nos.old ?? ""}</span>
        <span className="diff-num diff-num-new">{nos.new ?? ""}</span>
      </span>
      <span className="diff-text">{line || " "}</span>
    </div>
  );
}

/** The paths a diff touches, in order — the keys review comments are filed under. */
export function diffFiles(diff: string): string[] {
  return parseFiles(diff)
    .map((b) => b.file)
    .filter((f): f is string => !!f);
}

function parseFiles(diff: string): FileBlock[] {
  const blocks: FileBlock[] = [];
  let cur: FileBlock | null = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git")) {
      const m = line.match(/ b\/(.+)$/);
      cur = { file: m ? m[1] : line.slice(11), lines: [line] };
      blocks.push(cur);
    } else if (cur) {
      cur.lines.push(line);
    } else {
      cur = { file: null, lines: [line] };
      blocks.push(cur);
    }
  }
  return blocks;
}

/** A single diff hunk (e.g. the `diff_hunk` GitHub attaches to a review
 * comment), colour-coded like the full diff view. The last line is the one the
 * comment is anchored to, so we mark it. */
export function DiffHunk({ hunk }: { hunk: string }) {
  const lines = hunk.replace(/\n+$/, "").split("\n");
  const nums = lineNumbers(lines);
  return (
    <div className="diff-hunk-block">
      {lines.map((line, i) => (
        <DiffLine
          key={i}
          line={line}
          nos={nums[i]}
          className={`diff-line ${classify(line)}${
            i === lines.length - 1 ? " diff-anchor" : ""
          }`}
        />
      ))}
    </div>
  );
}

export function DiffView({
  diff,
  notes,
  noteState = "ready",
  sessionId,
  prNumber,
}: {
  diff: string;
  /** The review's comments per file (markdown), shown in the left column. */
  notes?: Record<string, string>;
  /** Why a file has no comments: nobody asked yet ("idle"), the review is being
   * written ("waiting"), or it landed and had nothing to say ("ready"). */
  noteState?: "idle" | "waiting" | "ready";
  // When present, each file block gets a "→ Claude" button that pastes just
  // that file's diff into the session for a targeted review.
  sessionId?: string;
  prNumber?: number;
}) {
  if (!diff.trim()) return <div className="placeholder">No diff.</div>;
  const blocks = parseFiles(diff);

  return (
    <div className="diff-view">
      {blocks.map((b, bi) => {
        const note = b.file ? notes?.[b.file] : undefined;
        const nums = lineNumbers(b.lines);
        return (
        <div key={bi} className="diff-file-block">
          <div className="diff-notes-col">
            {b.file && (
              <div className="diff-note-file" title={b.file}>
                {b.file.split("/").slice(-2).join("/")}
              </div>
            )}
            {note ? (
              <div
                className="md diff-note-md"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(note) }}
              />
            ) : noteState === "waiting" ? (
              // One walking fox per file would be a stampede of canvases; the
              // fox lives in the review header and each file just says it's next.
              <div className="diff-note-empty">reviewing…</div>
            ) : noteState === "ready" ? (
              <div className="diff-note-empty">no comments</div>
            ) : null}
            {sessionId && b.file && (
              <ToClaude
                sessionId={sessionId}
                text={fileReviewPrompt(b.file, prNumber, b.lines)}
                label="→ review"
                title="Paste this file's diff into Claude for a targeted review"
                className="diff-note-review"
              />
            )}
          </div>
          <div className="diff-lines-col">
            {b.lines.map((line, i) => (
              <DiffLine
                key={i}
                line={line}
                nos={nums[i]}
                className={`diff-line ${classify(line)}`}
              />
            ))}
          </div>
        </div>
        );
      })}
    </div>
  );
}
