// Word-level marks inside a diff's changed lines: each removed line is paired
// with the added line in the same place of the hunk, and the words that differ
// between the two are marked, so a rename or a one-character edit stands out
// from the rest of the line.

/** [start, end) character offsets in a line's code (without its +/- marker). */
export type Range = [number, number];

/** Lines longer than this, or pairs sharing less than this much, get no marks:
 * on a rewritten line every word would be marked, which says nothing. */
const MAX_CHARS = 500;
const MIN_SHARED = 0.4;
/** LCS table cells per pair and per file. A table this size takes about a
 * millisecond, and the file's total keeps a huge diff from freezing the view
 * (2,000 worst-case pairs take about 2s uncapped). */
const MAX_PAIR_CELLS = 40_000;
const MAX_FILE_CELLS = 20_000_000;

const tokens = (s: string) => s.match(/\w+|\s+|[^\w\s]/g) ?? [];

/** The changed ranges of `a` and `b`, or null when they're too different to
 * mark usefully or too costly to diff. `budget.cells` is what's left of the
 * file's allowance, and is spent here. */
export function wordRanges(a: string, b: string, budget = { cells: MAX_FILE_CELLS }): { a: Range[]; b: Range[] } | null {
  if (a.length > MAX_CHARS || b.length > MAX_CHARS || a === b) return null;
  const x = tokens(a);
  const y = tokens(b);
  // Most edits touch the middle of a line, so the shared ends never reach the table.
  let head = 0;
  while (head < x.length && head < y.length && x[head] === y[head]) head++;
  let tail = 0;
  while (tail < x.length - head && tail < y.length - head && x[x.length - 1 - tail] === y[y.length - 1 - tail]) tail++;
  const n = x.length - head - tail;
  const m = y.length - head - tail;
  const cells = (n + 1) * (m + 1);
  if (cells > MAX_PAIR_CELLS || cells > budget.cells) return null;
  budget.cells -= cells;
  // Longest common subsequence of the middle tokens, in one flat table.
  const w = m + 1;
  const t = new Int32Array(cells);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i * w + j] = x[head + i] === y[head + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
  const keepA = new Array<boolean>(x.length).fill(true);
  const keepB = new Array<boolean>(y.length).fill(true);
  for (let k = head; k < x.length - tail; k++) keepA[k] = false;
  for (let k = head; k < y.length - tail; k++) keepB[k] = false;
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (x[head + i] === y[head + j]) {
      keepA[head + i++] = true;
      keepB[head + j++] = true;
    } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
    else j++;
  }
  const shared = x.reduce((sum, tok, k) => (keepA[k] ? sum + tok.length : sum), 0);
  if (shared / Math.max(a.length, b.length) < MIN_SHARED) return null;
  const ranges = (line: string, toks: string[], keep: boolean[]) => {
    const out: Range[] = [];
    let at = 0;
    toks.forEach((tok, k) => {
      // Whitespace alone isn't worth a mark; between two marked words it joins them.
      if (!keep[k] && tok.trim()) {
        const last = out[out.length - 1];
        if (last && !line.slice(last[1], at).trim()) last[1] = at + tok.length;
        else out.push([at, at + tok.length]);
      }
      at += tok.length;
    });
    return out;
  };
  return { a: ranges(a, x, keepA), b: ranges(b, y, keepB) };
}

/** Marks for a file's diff lines, by line index: each run of removed lines is
 * paired line by line with the run of added lines right after it. */
export function wordMarks(lines: string[]): Map<number, Range[]> {
  const out = new Map<number, Range[]>();
  const budget = { cells: MAX_FILE_CELLS };
  for (let i = 0; i < lines.length; ) {
    if (!lines[i].startsWith("-") || lines[i].startsWith("--- ")) {
      i++;
      continue;
    }
    const delStart = i;
    while (i < lines.length && lines[i].startsWith("-")) i++;
    const addStart = i;
    while (i < lines.length && lines[i].startsWith("+") && !lines[i].startsWith("+++ ")) i++;
    const pairs = Math.min(addStart - delStart, i - addStart);
    for (let k = 0; k < pairs; k++) {
      const r = wordRanges(lines[delStart + k].slice(1), lines[addStart + k].slice(1), budget);
      if (!r) continue;
      if (r.a.length) out.set(delStart + k, r.a);
      if (r.b.length) out.set(addStart + k, r.b);
    }
  }
  return out;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** `html` (one line, highlighted or plain-escaped) with the text in `ranges`
 * wrapped in `<mark>`. Marks go inside each text run, so they never cross a
 * highlight span; an entity counts as the one character it stands for. */
export function markHtml(html: string | undefined, code: string, ranges: Range[]): string {
  const src = html ?? escapeHtml(code);
  const open = '<mark class="diff-word">';
  let out = "";
  let at = 0;
  let r = 0;
  let marking = false;
  for (const m of src.matchAll(/(<[^>]+>)|(&[#\w]+;)|([^<&])/g)) {
    if (m[1]) {
      out += marking ? `</mark>${m[1]}${open}` : m[1];
      continue;
    }
    while (r < ranges.length && ranges[r][1] <= at) r++;
    const on = r < ranges.length && ranges[r][0] <= at;
    if (on !== marking) out += on ? open : "</mark>";
    marking = on;
    out += m[2] ?? m[3];
    at++;
  }
  return marking ? `${out}</mark>` : out;
}
