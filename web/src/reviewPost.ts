// Turns den's review into a GitHub review (#16): a bullet naming a line inside
// the diff becomes an inline comment, and the rest goes in the body under its
// file's name. GitHub rejects the whole review if one inline comment sits
// outside the diff, so each line is checked against the diff first.
import { diffForFiles, lineNumbers } from "./DiffView.tsx";
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

/** New-side line numbers present in `file`'s part of the diff. */
export function linesInDiff(diff: string, file: string): Set<number> {
  const lines = diffForFiles(diff, [file]).split("\n");
  const nos = lineNumbers(lines);
  const out = new Set<number>();
  for (const n of nos) if (n.new !== null) out.add(n.new);
  return out;
}

export function buildReviewPost(
  overall: string,
  byFile: Record<string, string>,
  diff: string,
): ReviewPost {
  const comments: ReviewComment[] = [];
  const bodyParts: string[] = [];
  if (overall.trim()) bodyParts.push(overall.trim());
  for (const [path, md] of Object.entries(byFile)) {
    const inDiff = linesInDiff(diff, path);
    const leftover: string[] = [];
    for (const item of splitBullets(md)) {
      const line = bulletLine(item);
      if (line !== null && inDiff.has(line)) comments.push({ path, line, body: item });
      else leftover.push(`- ${item}`);
    }
    if (leftover.length) bodyParts.push(`**${path}**\n\n${leftover.join("\n")}`);
  }
  return { body: bodyParts.join("\n\n"), comments };
}
