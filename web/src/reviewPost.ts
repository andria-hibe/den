// Turns den's review into a GitHub review (#16): a bullet naming a line inside
// the diff becomes an inline comment, and the rest goes in the body under its
// file's name. GitHub rejects the whole review if one inline comment sits
// outside the diff, so each line is checked against the diff first.
import { diffForFiles, lineNumbers } from "./DiffView.tsx";
import { stripSource } from "./reviewNotes.ts";
import type { ReviewComment } from "../../server/github.ts";

export interface ReviewPost {
  body: string;
  comments: ReviewComment[];
}

/** Split a file's section into bullets: "- " / "* " items, with their
 * continuation lines. Text that isn't a bullet is kept as its own item. */
export function splitBullets(md: string): string[] {
  const items: string[] = [];
  let cur: string[] | null = null;
  for (const line of md.split("\n")) {
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      if (cur) items.push(cur.join("\n"));
      cur = [bullet[1]];
    } else if (line.trim() === "") {
      if (cur) items.push(cur.join("\n"));
      cur = null;
    } else if (cur) {
      cur.push(line.trim());
    } else {
      cur = [line.trim()];
    }
  }
  if (cur) items.push(cur.join("\n"));
  return items.map((s) => s.trim()).filter(Boolean);
}

/** The line a bullet opens with: "path:12", "path:12-18" (the end line), or
 * "line 12" / "L12". Null when it names none. */
export function bulletLine(text: string): number | null {
  const t = text.replace(/^[`*_]+/, "");
  const loc = /^[^\s:`]*:(\d+)(?:-(\d+))?/.exec(t);
  if (loc) return Number(loc[2] ?? loc[1]);
  const word = /^(?:line|L)\s*(\d+)/i.exec(t);
  return word ? Number(word[1]) : null;
}

/** New-side lines present in `file`'s part of the diff, by number. */
export function linesInDiff(diff: string, file: string): Map<number, string> {
  const lines = diffForFiles(diff, [file]).split("\n");
  const nos = lineNumbers(lines);
  const out = new Map<number, string>();
  nos.forEach((n, i) => {
    if (n.new !== null) out.set(n.new, lines[i].slice(1));
  });
  return out;
}

/** The line a bullet is about, put right when its number drifted: the code it
 * quotes (the first code span) wins over the number, as long as that code is
 * on exactly one line of the file's diff. */
export function anchorLine(item: string, inDiff: Map<number, string>): number | null {
  const line = bulletLine(item);
  // The span right after "path:line" quotes the line; a later span is usually
  // about some other code, so it only counts when the number isn't in the diff.
  const right = /^[`*_]*[^\s:`]*:\d+(?:-\d+)?`?\s*`([^`]{4,})`/.exec(item)?.[1].trim();
  const quote = right ?? (line !== null && inDiff.has(line) ? undefined : /`([^`]{4,})`/.exec(item)?.[1].trim());
  if (!quote || (line !== null && inDiff.get(line)?.includes(quote))) return line;
  const hits = [...inDiff].filter(([, text]) => text.includes(quote));
  return hits.length === 1 ? hits[0][0] : line;
}

export function buildReviewPost(
  overall: string,
  byFile: Record<string, string>,
  diff: string,
): ReviewPost {
  const comments: ReviewComment[] = [];
  const bodyParts: string[] = [];
  if (overall.trim()) bodyParts.push(stripSource(overall.trim()));
  for (const [path, md] of Object.entries(byFile)) {
    const inDiff = linesInDiff(diff, path);
    const leftover: string[] = [];
    for (const raw of splitBullets(md)) {
      const item = stripSource(raw);
      const line = anchorLine(item, inDiff);
      const moved = line !== null && line !== bulletLine(item);
      // The text says the line it's posted on, not the one the review guessed.
      const body = moved ? item.replace(/^([`*_]*[^\s:`]*:)\d+(?:-\d+)?/, `$1${line}`) : item;
      if (line !== null && inDiff.has(line)) comments.push({ path, line, body });
      else leftover.push(`- ${item}`);
    }
    if (leftover.length) bodyParts.push(`**${path}**\n\n${leftover.join("\n")}`);
  }
  return { body: bodyParts.join("\n\n"), comments };
}
