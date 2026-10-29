// Opening a file path printed in a terminal (#41). Clicking a path should
// show the file, never run it: `open` on a .command, .app, or script would
// execute it, so only files that open in a viewer are opened; anything else
// is revealed in Finder.
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";
import { within } from "./fs.ts";

const VIEWABLE = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf",
  ".md", ".txt", ".log", ".json", ".csv", ".html", ".diff",
]);

/** Claude Code's scratchpads live under the system temp dir, outside $HOME. */
const SCRATCH = /^\/(private\/)?tmp\/claude-\d+\//;

/** The `open` arguments for a clicked path, or null when it isn't one to
 * open: missing, or outside $HOME and Claude's scratchpads. */
export function openArgs(raw: string): string[] | null {
  const expanded = raw.startsWith("~/") ? homedir() + raw.slice(1) : raw;
  if (!expanded.startsWith("/")) return null;
  const path = resolve(expanded);
  if (!existsSync(path)) return null;
  const real = realpathSync(path);
  if (!within(real) && !SCRATCH.test(real)) return null;
  if (statSync(real).isDirectory() || VIEWABLE.has(extname(real).toLowerCase())) return [real];
  return ["-R", real];
}
