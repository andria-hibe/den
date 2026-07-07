import Database from "better-sqlite3";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync } from "node:fs";

// Persisted session metadata. Live PTY processes and scrollback live in memory
// (server/sessions.ts); this table is what survives a browser refresh or a
// server restart so the rail stays stable.
export interface SessionRow {
  id: string;
  name: string;
  color: string;
  cwd: string;
  shell: 0 | 1;
  claudeSessionId: string | null;
  status: string; // "running" | "exited"
  createdAt: number;
  lastActive: number;
  /** Workspace grouping: a Claude session groups a main pane + a shell pane. */
  groupId: string;
  role: string; // "main" | "shell"
  // --- Session context (restores the rail after a restart) ---
  /** Git branch captured when the session started. */
  branch: string | null;
  /** Linear ticket identifier this session is for (e.g. "FAST-6115"). */
  ticket: string | null;
  /** Lightweight "just looking" ticket viewer session. */
  look: 0 | 1;
  /** GitHub PR layout: "review" (others' PR) or "mypr" (your own). */
  view: string | null;
  /** GitHub PR number + nameWithOwner repo, if this is a PR session. */
  pr: number | null;
  prRepo: string | null;
  /** Title was locked (manual rename or descriptive ticket/PR title). */
  titleLocked: 0 | 1;
}

// Stable per-user location (works identically for the CLI and the packaged
// desktop app); DEN_DB overrides it (used by tests).
const DB_PATH = process.env.DEN_DB ?? join(homedir(), ".den", "den.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    cwd TEXT NOT NULL,
    shell INTEGER NOT NULL DEFAULT 0,
    claudeSessionId TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    createdAt INTEGER NOT NULL,
    lastActive INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Migrate older DBs that predate workspace grouping or session-context columns.
for (const col of [
  "groupId TEXT",
  "role TEXT",
  "branch TEXT",
  "ticket TEXT",
  "look INTEGER NOT NULL DEFAULT 0",
  "view TEXT",
  "pr INTEGER",
  "prRepo TEXT",
  "titleLocked INTEGER NOT NULL DEFAULT 0",
]) {
  try {
    db.exec(`ALTER TABLE sessions ADD COLUMN ${col}`);
  } catch {
    // column already exists
  }
}

const stmts = {
  insert: db.prepare(
    `INSERT INTO sessions (id, name, color, cwd, shell, claudeSessionId, status, createdAt, lastActive, groupId, role, branch, ticket, look, view, pr, prRepo, titleLocked)
     VALUES (@id, @name, @color, @cwd, @shell, @claudeSessionId, @status, @createdAt, @lastActive, @groupId, @role, @branch, @ticket, @look, @view, @pr, @prRepo, @titleLocked)`,
  ),
  all: db.prepare(`SELECT * FROM sessions ORDER BY createdAt ASC`),
  update: db.prepare(
    `UPDATE sessions SET name=@name, color=@color, status=@status,
       claudeSessionId=@claudeSessionId, lastActive=@lastActive,
       branch=@branch, ticket=@ticket, look=@look, view=@view,
       pr=@pr, prRepo=@prRepo, titleLocked=@titleLocked WHERE id=@id`,
  ),
  delete: db.prepare(`DELETE FROM sessions WHERE id=?`),
  markAllExited: db.prepare(
    `UPDATE sessions SET status='exited' WHERE status='running'`,
  ),
  getSetting: db.prepare(`SELECT value FROM settings WHERE key=?`),
  setSetting: db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ),
  deleteSetting: db.prepare(`DELETE FROM settings WHERE key=?`),
};

export const store = {
  insert(row: SessionRow) {
    stmts.insert.run(row);
  },
  all(): SessionRow[] {
    return stmts.all.all() as SessionRow[];
  },
  update(row: SessionRow) {
    stmts.update.run(row);
  },
  delete(id: string) {
    stmts.delete.run(id);
  },
  /** On boot, any session marked running is stale (its PTY is gone). */
  markAllExited() {
    stmts.markAllExited.run();
  },
  getSetting(key: string): string | null {
    const row = stmts.getSetting.get(key) as { value: string } | undefined;
    return row?.value ?? null;
  },
  setSetting(key: string, value: string) {
    stmts.setSetting.run(key, value);
  },
  deleteSetting(key: string) {
    stmts.deleteSetting.run(key);
  },
};
