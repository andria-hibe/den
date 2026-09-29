import { useMemo, useState } from "react";
import { renderMarkdown } from "./markdown.ts";
import { highlightLines, languageFor } from "./highlight.ts";
import { ToClaude } from "./ToClaude.tsx";
import { fileReviewPrompt } from "./prompts.ts";

interface FileBlock {
  file: string | null;
  lines: string[];
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

/** Number a unified diff's lines the way the files are numbered, so a review
 * saying "line 448" can be found. Only lines inside a hunk are numbered: the
 * `---`/`+++` preamble also starts with `-`/`+`. */
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

function DiffLine({
  line,
  nos,
  className,
  html,
}: {
  line: string;
  nos: LineNos;
  className: string;
  /** Highlighted HTML for the line's code (without its +/-/space marker),
   * escaped by highlight.js. Absent: render the line as plain text. */
  html?: string;
}) {
  return (
    <div className={className}>
      <span className="diff-gutter" aria-hidden="true">
        <span className="diff-num">{nos.old ?? ""}</span>
        <span className="diff-num diff-num-new">{nos.new ?? ""}</span>
      </span>
      {html === undefined ? (
        <span className="diff-text">{line || " "}</span>
      ) : (
        <span className="diff-text">
          <span className="diff-marker">{line[0]}</span>
          <span dangerouslySetInnerHTML={{ __html: html || " " }} />
        </span>
      )}
    </div>
  );
}

/** Highlighted HTML for the code lines of one file's diff, by line index;
 * lines outside a hunk (headers) have none. Null: highlight nothing. */
function useHighlighted(file: string | null, lines: string[], nums: LineNos[], on: boolean) {
  return useMemo(() => {
    if (!on || !file) return null;
    const idx: number[] = [];
    const code: string[] = [];
    lines.forEach((l, i) => {
      if (nums[i].old !== null || nums[i].new !== null) {
        idx.push(i);
        code.push(l.slice(1));
      }
    });
    const html = highlightLines(code, languageFor(file));
    if (!html) return null;
    const byLine = new Map<number, string>();
    idx.forEach((lineIdx, k) => byLine.set(lineIdx, html[k]));
    return byLine;
  }, [file, lines, nums, on]);
}

/** Added and removed line counts for a file's collapsed header. */
function changeCounts(lines: string[]) {
  let add = 0;
  let del = 0;
  for (const l of lines) {
    if (l.startsWith("+") && !l.startsWith("+++")) add++;
    else if (l.startsWith("-") && !l.startsWith("---")) del++;
  }
  return { add, del };
}

/** One file of the diff: its review comments on the left, its lines on the
 * right, collapsible to a one-line header. */
function DiffFileBlock({
  block,
  note,
  noteState,
  sessionId,
  prNumber,
  collapsed,
  onToggle,
}: {
  block: FileBlock;
  note?: string;
  noteState: "idle" | "waiting" | "ready";
  sessionId?: string;
  prNumber?: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const b = block;
  const nums = useMemo(() => lineNumbers(b.lines), [b.lines]);
  // Only expanded files are highlighted, so collapsed ones cost nothing.
  const html = useHighlighted(b.file, b.lines, nums, !collapsed);
  const { add, del } = useMemo(() => changeCounts(b.lines), [b.lines]);
  return (
    <div className={`diff-file-block${collapsed ? " collapsed" : ""}`}>
      <div className="diff-notes-col">
        {b.file && (
          <button
            className="diff-note-file"
            title={collapsed ? `show ${b.file}` : `collapse ${b.file}`}
            onClick={onToggle}
          >
            <span className="diff-fold">{collapsed ? "▸" : "▾"}</span>
            {b.file.split("/").slice(-2).join("/")}
          </button>
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
            title="Ask Claude for a targeted review of this file"
            className="diff-note-review"
          />
        )}
      </div>
      <div className="diff-lines-col">
        {collapsed ? (
          <button className="diff-collapsed" onClick={onToggle} title={`show ${b.file ?? "diff"}`}>
            <span className="diff-add-count">+{add}</span>{" "}
            <span className="diff-del-count">−{del}</span> · show
          </button>
        ) : (
          b.lines.map((line, i) => (
            <DiffLine
              key={i}
              line={line}
              nos={nums[i]}
              className={`diff-line ${classify(line)}`}
              html={html?.get(i)}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** The paths a diff touches, in order — the keys review comments are filed under. */
export function diffFiles(diff: string): string[] {
  return parseFiles(diff)
    .map((b) => b.file)
    .filter((f): f is string => !!f);
}

/** The sub-diff covering just `files`, in the order given (a guide section's
 * order, not the diff's). Files the diff doesn't contain are skipped. */
export function diffForFiles(diff: string, files: string[]): string {
  const byFile = new Map<string, string[]>();
  for (const b of parseFiles(diff)) if (b.file) byFile.set(b.file, b.lines);
  return files
    .map((f) => byFile.get(f))
    .filter((lines): lines is string[] => !!lines)
    .map((lines) => lines.join("\n"))
    .join("\n");
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

/** One diff hunk, such as the `diff_hunk` GitHub attaches to a review comment.
 * Its last line is the one the comment is anchored to, so it's marked. */
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
  startCollapsed,
}: {
  diff: string;
  /** The review's comments per file (markdown), shown in the left column. */
  notes?: Record<string, string>;
  /** Why a file has no comments: nobody asked ("idle"), being written
   * ("waiting"), or nothing to say ("ready"). */
  noteState?: "idle" | "waiting" | "ready";
  // When present, each file gets a "→ review" button asking the session for a
  // targeted review of that file.
  sessionId?: string;
  prNumber?: number;
  /** Files to start collapsed (churn: lockfiles, generated code). A file with
   * review comments starts open anyway, so a finding is never folded away. */
  startCollapsed?: (file: string) => boolean;
}) {
  const blocks = useMemo(() => parseFiles(diff), [diff]);
  // Files the reader folded or unfolded, overriding the default.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  if (!diff.trim()) return <div className="placeholder">No diff.</div>;
  const isCollapsed = (file: string | null, hasNote: boolean) => {
    if (!file) return false;
    if (file in toggled) return toggled[file];
    return !hasNote && !!startCollapsed?.(file);
  };
  const files = blocks.map((b) => b.file).filter((f): f is string => !!f);
  const setAll = (collapsed: boolean) =>
    setToggled(Object.fromEntries(files.map((f) => [f, collapsed])));

  return (
    <div className="diff-view">
      {files.length > 1 && (
        <div className="diff-toolbar">
          <button className="btn-ghost" onClick={() => setAll(true)}>
            collapse all
          </button>
          <button className="btn-ghost" onClick={() => setAll(false)}>
            expand all
          </button>
        </div>
      )}
      {blocks.map((b, bi) => {
        const note = b.file ? notes?.[b.file] : undefined;
        const collapsed = isCollapsed(b.file, !!note);
        return (
          <DiffFileBlock
            key={b.file ?? bi}
            block={b}
            note={note}
            noteState={noteState}
            sessionId={sessionId}
            prNumber={prNumber}
            collapsed={collapsed}
            onToggle={() => b.file && setToggled((t) => ({ ...t, [b.file!]: !collapsed }))}
          />
        );
      })}
    </div>
  );
}
