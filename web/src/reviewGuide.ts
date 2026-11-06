// Parses the reading guide a review session writes. The format is set by
// `reviewInstruction` (server/sessions.ts). Parsing is forgiving, like
// `reviewNotes.ts`: Claude may bullet the paths, backtick or shorten them, or
// pick another heading level.

import { looksLikePath, matchFile } from "./reviewNotes.ts";

export type NoteTone = "explains" | "look closely" | "risk";

/** A guide note pinned to one line: context, a judgment call, or a likely bug. */
export interface GuideNote {
  tone: NoteTone;
  file: string;
  line: number;
  text: string;
}

export interface GuideSection {
  title: string;
  /** The section's prose, minus the file list and notes. */
  body: string;
  /** The diff paths this section groups, in diff order. */
  files: string[];
  notes: GuideNote[];
}

export interface ParsedGuide {
  /** Everything before the first section heading. */
  intro: string;
  sections: GuideSection[];
  /** Changed files no section claimed, in diff order. */
  leftover: string[];
  /** Files more than one section named (the first keeps them). */
  twice: string[];
  /** Paths a Files line named that aren't in the diff. */
  unknown: string[];
}

/** "- risk: path:12 `code` - text", the guide's line notes. */
const NOTE_LINE = /^\s*[-*+]\s+(risk|look closely|explains?)\s*:\s*`?([^\s`:]+):(\d+)`?\s*[-:]?\s*(.*)$/i;

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*$/;
const FENCE = /^ {0,3}(?:```|~~~)/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
/** `Files:` / `**Paths**:` — the line that names a section's files. */
const FILES_LINE = /^\s*(?:[-*+]\s+)?[*_`]*(?:files?|paths?)[*_`]*\s*:\s*(.*)$/i;
/** A title that just names the document; the UI already labels the intro. */
const GENERIC = /^(reading\s+)?(guide|overview|summary|orientation|intro(duction)?)$/i;

function cleanTitle(text: string): string {
  return text
    .replace(/`/g, "")
    .replace(/^[*_\s]+/, "")
    .replace(/[*_\s:]+$/, "")
    .trim();
}

/** The diff paths in a `Files:` line or one of its bullets. Tokens are matched
 * against the diff, so prose drops out on its own. */
function pathsIn(text: string, files: string[], unknown?: string[]): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[,;]+|\s+/)) {
    const tok = raw.replace(/^[("'[`]+|[)"'\].`]+$/g, "");
    if (tok.length < 3) continue;
    const f = matchFile(tok, files);
    if (f) out.push(f);
    else if (unknown && looksLikePath(tok)) unknown.push(tok);
  }
  return out;
}

/** Last resort for a section with no `Files:` line: any backticked path in its
 * prose. Kept narrow (must look like a path) so prose can't claim a file. */
function pathsInProse(body: string, files: string[]): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/`([^`\n]+)`/g)) {
    if (!looksLikePath(m[1])) continue;
    const f = matchFile(m[1], files);
    if (f) out.push(f);
  }
  return out;
}

export function parseGuide(md: string, files: string[]): ParsedGuide {
  const introLines: string[] = [];
  const raw: { title: string; lines: string[]; files: string[]; notes: GuideNote[] }[] = [];
  const unknown: string[] = [];
  let cur: (typeof raw)[number] | null = null;
  let fenced = false;
  let inFiles = false;

  for (const line of String(md ?? "").split("\n")) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      inFiles = false;
      (cur?.lines ?? introLines).push(line);
      continue;
    }
    const h = fenced ? null : HEADING.exec(line);
    if (h) {
      const title = cleanTitle(h[2]);
      // A "# Guide" title before any prose is the document's own name.
      if (!cur && introLines.join("").trim() === "" && GENERIC.test(title)) continue;
      // Claude sometimes falls back to the review's `## <path>` shape; treat
      // such a heading as a one-file section rather than losing the grouping.
      const asFile = matchFile(title, files);
      cur = { title, lines: [], files: asFile ? [asFile] : [], notes: [] };
      raw.push(cur);
      inFiles = false;
      continue;
    }
    if (cur) {
      if (fenced) {
        cur.lines.push(line);
        continue;
      }
      const note = NOTE_LINE.exec(line);
      const noteFile = note && matchFile(note[2], files);
      if (note && noteFile) {
        const tone = note[1].toLowerCase().startsWith("explain") ? "explains" : (note[1].toLowerCase() as NoteTone);
        cur.notes.push({ tone, file: noteFile, line: Number(note[3]), text: note[4].trim() });
        inFiles = false;
        continue;
      }
      const fl = FILES_LINE.exec(line);
      if (fl) {
        cur.files.push(...pathsIn(fl[1], files, unknown));
        inFiles = true;
        continue;
      }
      const b = inFiles ? BULLET.exec(line) : null;
      if (b) {
        cur.files.push(...pathsIn(b[1], files, unknown));
        continue;
      }
      // Blank lines inside a file list are just spacing; anything else is prose
      // again (and ends the list).
      if (inFiles && line.trim() === "") continue;
      inFiles = false;
      cur.lines.push(line);
      continue;
    }
    introLines.push(line);
  }

  // First section to claim a file keeps it, so a diff is never rendered twice.
  const order = new Map(files.map((f, i) => [f, i]));
  const claimed = new Set<string>();
  const twice = new Set<string>();
  const sections: GuideSection[] = [];
  for (const s of raw) {
    const body = s.lines.join("\n").trim();
    const named = s.files.length ? s.files : pathsInProse(body, files);
    for (const f of new Set(named)) if (claimed.has(f)) twice.add(f);
    const mine = [...new Set(named)].filter((f) => !claimed.has(f));
    for (const f of mine) claimed.add(f);
    if (!body && mine.length === 0) continue;
    mine.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    sections.push({ title: s.title, body, files: mine, notes: s.notes });
  }

  return {
    intro: introLines.join("\n").trim(),
    sections,
    leftover: files.filter((f) => !claimed.has(f)),
    twice: [...twice],
    unknown: [...new Set(unknown)],
  };
}
