// Splits the markdown review a review session writes to its notepad into an
// overall section plus per-file sections, so den can render each file's comments
// beside that file's own diff instead of in a separate column.
//
// The contract is set by `reviewInstruction` (server/sessions.ts): general
// review first, then one `## <file path>` heading per file commented on. Parsing
// is deliberately forgiving — Claude may shorten the path, wrap it in backticks,
// or pick a different heading level.

export interface ParsedReview {
  /** Everything before the first per-file heading — the general review. */
  overall: string;
  /** Per-file comments, keyed by the path as it appears in the diff. */
  byFile: Record<string, string>;
}

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*$/;
const FENCE = /^ {0,3}(?:```|~~~)/;
/** A generic top heading; the UI already labels the overall block. */
const GENERIC = /^(overall|overview|summary|general|review)(\s+(review|summary|notes|comments))?$/i;

/** Peel matched emphasis wrappers (`**x**`, `_x_`, …) off a heading. Only
 * *paired* markers go — stripping `_` wholesale would mangle the many real paths
 * that contain one (`query_notification_subscriptions.test.ts`), and a path that
 * doesn't match its file lands in the previous file's column. */
function stripEmphasis(text: string): string {
  let s = text.trim();
  for (;;) {
    const m = /^(\*\*\*|\*\*|\*|___|__|_)([\s\S]+?)\1$/.exec(s);
    if (!m) return s;
    s = m[2].trim();
  }
}

/** Strip the decoration Claude tends to put around a path in a heading. */
function normalize(text: string): string {
  return stripEmphasis(text.replace(/`/g, ""))
    .replace(/^[*_\s]*(file|path)[*_\s]*[:\-–—]\s*[*_\s]*/i, "")
    .replace(/[:.]+$/, "")
    .trim();
}

/** Does a heading read like a file path (rather than prose)? Used to close a
 * file's section when the review comments on a file the diff doesn't contain —
 * without this its notes would be appended to the previous file's column. */
export function looksLikePath(text: string): boolean {
  const t = normalize(text);
  if (!t || /\s/.test(t)) return false;
  return t.includes("/") || /\.[a-z0-9]{1,8}$/i.test(t);
}

/** Match a heading to one of the diff's files, tolerating a shortened path. */
export function matchFile(heading: string, files: string[]): string | null {
  const h = normalize(heading).toLowerCase();
  if (!h) return null;
  // Longest path first, so a full path wins over a bare basename when both fit.
  const candidates = [...files].sort((a, b) => b.length - a.length);
  for (const f of candidates) if (h === f.toLowerCase()) return f;
  for (const f of candidates) {
    const lf = f.toLowerCase();
    const base = lf.split("/").pop()!;
    // "## src/App.tsx" for web/src/App.tsx, "## App.tsx", or a path plus prose
    // ("## web/src/App.tsx — 2 issues").
    if (lf.endsWith(`/${h}`) || h === base || h.includes(lf) || h.includes(base))
      return f;
  }
  return null;
}

export function parseReview(md: string, files: string[]): ParsedReview {
  const overallLines: string[] = [];
  const fileLines = new Map<string, string[]>();
  // Sections about paths that aren't in this diff — kept, but shown with the
  // general review rather than misfiled under whichever file came before.
  const orphanLines: string[] = [];
  let bucket = overallLines;
  let fenced = false;

  for (const line of String(md ?? "").split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      bucket.push(line);
      continue;
    }
    const m = fenced ? null : HEADING.exec(line);
    if (m) {
      const text = normalize(m[2]);
      const file = matchFile(text, files);
      if (file) {
        // The heading is just the path — the diff block already shows it.
        bucket = fileLines.get(file) ?? [];
        fileLines.set(file, bucket);
        continue;
      }
      // Drop a leading "Overall"/"Summary" heading (the UI supplies its own);
      // any other heading is real content and stays.
      if (
        bucket === overallLines &&
        overallLines.join("").trim() === "" &&
        GENERIC.test(text)
      )
        continue;
      // A path the diff doesn't have still ends the current file's section.
      if (looksLikePath(text)) bucket = orphanLines;
    }
    bucket.push(line);
  }

  const byFile: Record<string, string> = {};
  for (const [file, lines] of fileLines) {
    const body = lines.join("\n").trim();
    if (body) byFile[file] = body;
  }
  const orphans = orphanLines.join("\n").trim();
  const overall = [overallLines.join("\n").trim(), orphans].filter(Boolean).join("\n\n");
  return { overall, byFile };
}
