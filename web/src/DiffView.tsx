// Renders a unified diff (from `gh pr diff`) grouped per file, with a left
// column of Claude's per-file summaries aligned to each file's block so you can
// scan the changes at a glance.
interface FileBlock {
  file: string | null;
  lines: string[];
}

function classify(line: string): string {
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

export function DiffView({
  diff,
  summaries,
  loadingSummaries,
}: {
  diff: string;
  summaries?: Record<string, string>;
  loadingSummaries?: boolean;
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
