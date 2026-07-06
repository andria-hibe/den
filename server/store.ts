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
`);

const stmts = {
  insert: db.prepare(
    `INSERT INTO sessions (id, name, color, cwd, shell, claudeSessionId, status, createdAt, lastActive)
     VALUES (@id, @name, @color, @cwd, @shell, @claudeSessionId, @status, @createdAt, @lastActive)`,
  ),
  all: db.prepare(`SELECT * FROM sessions ORDER BY createdAt ASC`),
  update: db.prepare(
    `UPDATE sessions SET name=@name, color=@color, status=@status,
       claudeSessionId=@claudeSessionId, lastActive=@lastActive WHERE id=@id`,
  ),
  delete: db.prepare(`DELETE FROM sessions WHERE id=?`),
  markAllExited: db.prepare(
    `UPDATE sessions SET status='exited' WHERE status='running'`,
  ),
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
};
