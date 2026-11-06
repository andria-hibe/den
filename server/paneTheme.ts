// The theme den's window shows, which new Claude panes start in (Claude Code
// reads `theme` from --settings once, at launch). Kept on disk so panes that
// start before the window reports in still match it.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./dataDir.ts";
import { logWarn } from "./log.ts";

export type PaneTheme = "light" | "dark";

const FILE = join(DATA_DIR, "theme.txt");

export const isPaneTheme = (t: unknown): t is PaneTheme => t === "light" || t === "dark";

function readSaved(): PaneTheme {
  try {
    const t = readFileSync(FILE, "utf8").trim();
    if (isPaneTheme(t)) return t;
  } catch {
    // first run
  }
  return "dark";
}

let current: PaneTheme = readSaved();

export const paneTheme = (): PaneTheme => current;

export function setPaneTheme(t: PaneTheme): void {
  if (t === current) return;
  current = t;
  try {
    writeFileSync(FILE, t);
  } catch (err) {
    logWarn("pane theme", err);
  }
}

/** The theme a Claude pane's args start it in: Claude Code's default (dark)
 * unless its --settings name one. */
export function themeFromArgs(args: string[]): PaneTheme {
  const i = args.indexOf("--settings");
  if (i < 0) return "dark";
  try {
    const t = (JSON.parse(args[i + 1] ?? "") as { theme?: unknown }).theme;
    return t === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
