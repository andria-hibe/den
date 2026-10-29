// Moving from Den to Burrow: copy Den's sessions, notepads, review files, and
// settings into Burrow's data dir, so each session reopens in Burrow on its
// own conversation. Den must be quit first: both apps owning one session's
// terminal is what the separate data dirs exist to prevent.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR } from "./edition.ts";
import { readForeignDb, store, type SessionRow } from "./store.ts";
import { HANDOVER_TEMPLATE } from "../shared/handover.ts";

const DEN_DIR = process.env.DEN_IMPORT_FROM ?? join(homedir(), ".den");
const DONE = "den_imported";
// The window's place belongs to each app; everything else carries over.
const SKIP_SETTINGS = new Set(["window_state"]);

/** Den is open on its data. A DEN_IMPORT_FROM source is a copy, which no
 * running Den owns. */
function denRunning(): boolean {
  if (process.env.DEN_IMPORT_FROM) return false;
  try {
    execFileSync("pgrep", ["-x", "Den"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export interface DenImportStatus {
  /** Den has data and it hasn't been imported yet. */
  available: boolean;
  denRunning: boolean;
  sessions: number;
}

export function denImportStatus(): DenImportStatus {
  const db = join(DEN_DIR, "den.db");
  if (store.getSetting(DONE) || !existsSync(db)) return { available: false, denRunning: false, sessions: 0 };
  const known = new Set(store.all().map((r) => r.id));
  const sessions = readForeignDb(db).sessions.filter((r) => r.role === "main" && !known.has(r.id)).length;
  return { available: sessions > 0, denRunning: denRunning(), sessions };
}

/** Copy one folder's files that the destination doesn't have yet. */
function copyMissing(from: string, to: string): number {
  if (!existsSync(from)) return 0;
  mkdirSync(to, { recursive: true });
  let n = 0;
  for (const name of readdirSync(from)) {
    const dest = join(to, name);
    if (existsSync(dest) || name.endsWith(".tmp")) continue;
    try {
      copyFileSync(join(from, name), dest);
      n++;
    } catch {
      // a directory or an unreadable file: not part of a session
    }
  }
  return n;
}

/** What makes two sessions the same piece of work: its ticket, its PR, or
 * (for a workspace with neither) its checkout. */
function workKey(r: SessionRow): string {
  if (r.ticket) return `ticket:${r.ticket}`;
  if (r.pr && r.prRepo) return `pr:${r.view ?? ""}:${r.prRepo}#${r.pr}`;
  return `cwd:${r.view ?? ""}:${r.cwd}`;
}

/** A notepad nobody has written in yet. */
function untouched(path: string): boolean {
  try {
    return readFileSync(path, "utf8").trim() === `# Handover\n\n${HANDOVER_TEMPLATE}`.trim();
  } catch {
    return true;
  }
}

/** Import Den's data. Returns the rows to load; throws "den_running" while
 * Den is open. Files first, so a session never loads without its notepad. */
export function importFromDen(): { rows: ReturnType<typeof readForeignDb>["sessions"]; files: number } {
  if (denRunning()) throw new Error("den_running");
  const { sessions, settings } = readForeignDb(join(DEN_DIR, "den.db"));
  let files = 0;
  for (const dir of ["progress", "review", "inbox"]) files += copyMissing(join(DEN_DIR, dir), join(DATA_DIR, dir));
  // A session already open in Burrow for the same work is kept, not
  // duplicated; it takes Den's handover if its own is still empty.
  const mine = store.all();
  const known = new Set(mine.map((r) => r.id));
  const open = new Map(mine.filter((r) => r.role === "main").map((r) => [workKey(r), r]));
  const skipGroups = new Set<string>();
  for (const den of sessions.filter((r) => r.role === "main")) {
    const twin = open.get(workKey(den));
    if (!twin) continue;
    skipGroups.add(den.groupId ?? den.id);
    const ours = join(DATA_DIR, "progress", `${twin.groupId}.md`);
    const theirs = join(DEN_DIR, "progress", `${den.groupId}.md`);
    if (existsSync(theirs) && untouched(ours)) copyFileSync(theirs, ours);
  }
  const rows = sessions.filter((r) => !known.has(r.id) && !skipGroups.has(r.groupId ?? r.id));
  for (const row of rows) store.insert(row);
  for (const { key, value } of settings) {
    if (!SKIP_SETTINGS.has(key) && store.getSetting(key) === null) store.setSetting(key, value);
  }
  store.setSetting(DONE, new Date().toISOString());
  return { rows, files };
}
