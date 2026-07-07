// Renders a unified diff (from `gh pr diff`) grouped per file, with a left
// column of Claude's per-file summaries aligned to each file's block so you can
// scan the changes at a glance.
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
  return (
    <div className="diff-hunk-block">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`diff-line ${classify(line)}${
            i === lines.length - 1 ? " diff-anchor" : ""
          }`}
        >
          {line || " "}
        </div>
      ))}
    </div>
  );
}

export function DiffView({
  diff,
  summaries,
  loadingSummaries,
  sessionId,
  prNumber,
}: {
  diff: string;
  summaries?: Record<string, string>;
  loadingSummaries?: boolean;
  // When present, each file block gets a "→ Claude" button that pastes just
  // that file's diff into the session for a targeted review.
  sessionId?: string;
  prNumber?: number;
}) {
  if (!diff.trim()) return <div className="placeholder">No diff.</div>;
  const blocks = parseFiles(diff);

  return (
    <div className="diff-view">
      {blocks.map((b, bi) => (
        <div key={bi} className="diff-file-block">
          <div className="diff-summary-col">
            {b.file && (
              <div className="diff-sum-file" title={b.file}>
                {b.file.split("/").slice(-2).join("/")}
              </div>
            )}
            <div className="diff-sum-text">
              {b.file && summaries?.[b.file]
                ? summaries[b.file]
                : loadingSummaries
                  ? "summarising…"
                  : ""}
            </div>
            {sessionId && b.file && (
              <ToClaude
                sessionId={sessionId}
                text={fileReviewPrompt(b.file, prNumber, b.lines)}
                label="→ review"
                title="Paste this file's diff into Claude for a targeted review"
                className="diff-sum-review"
              />
            )}
          </div>
          <div className="diff-lines-col">
            {b.lines.map((line, i) => (
              <div key={i} className={`diff-line ${classify(line)}`}>
                {line || " "}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
