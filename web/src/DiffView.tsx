// Renders a unified diff (from `gh pr diff`) with per-file headers and
// added/removed line colouring.
export function DiffView({ diff }: { diff: string }) {
  if (!diff.trim()) return <div className="placeholder">No diff.</div>;
  const lines = diff.split("\n");
  const out: React.ReactNode[] = [];
  lines.forEach((line, i) => {
    let cls = "diff-ctx";
    if (line.startsWith("diff --git")) cls = "diff-file";
    else if (
      line.startsWith("index ") ||
      line.startsWith("--- ") ||
      line.startsWith("+++ ") ||
      line.startsWith("new file") ||
      line.startsWith("deleted file") ||
      line.startsWith("similarity ") ||
      line.startsWith("rename ")
    )
      cls = "diff-meta";
    else if (line.startsWith("@@")) cls = "diff-hunk";
    else if (line.startsWith("+")) cls = "diff-add";
    else if (line.startsWith("-")) cls = "diff-del";
    out.push(
      <div key={i} className={`diff-line ${cls}`}>
        {line || " "}
      </div>,
    );
  });
  return <div className="diff-view">{out}</div>;
}
