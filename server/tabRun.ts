// A command den types into a shell tab (set up, run) ends with a marker line
// carrying its exit status, so den can tell the workspace's Claude pane how
// it went (#37).

export type TabRunLabel = "set up" | "run";

/** Shell to append after the command. The tab echoes this line as typed,
 * with `%s` where the status goes, so only the printed marker has a number. */
export function finishMarker(label: TabRunLabel): string {
  return `; printf '\\n[den] ${label} finished with exit %s\\n' $?`;
}

const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

/** Terminal output as plain lines: escape sequences gone, and a line redrawn
 * with `\r` reduced to what it showed last. */
export function plainLines(output: string): string[] {
  return output
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.split("\r").filter(Boolean).pop() ?? "")
    .map((l) => l.trimEnd());
}

/** The exit status from a finish marker in `output`, and the lines before it. */
export function parseFinish(
  output: string,
  label: TabRunLabel,
): { exit: number; before: string[] } | null {
  const lines = plainLines(output);
  const re = new RegExp(`^\\[den\\] ${label} finished with exit (\\d+)$`);
  const at = lines.findIndex((l) => re.test(l));
  if (at < 0) return null;
  // The shell's echo (and redraws) of the typed command carry the marker too.
  const typed = `[den] ${label} finished with exit %s`;
  const before = lines.slice(0, at).filter((l) => l.trim() && !l.includes(typed));
  return { exit: Number(lines[at].match(re)![1]), before };
}
