import * as pty from "node-pty";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { store, type SessionRow } from "./store.ts";
import type { ServerMessage } from "./ws-protocol.ts";

const CLAUDE_BIN = process.env.MC_CLAUDE_BIN ?? "claude";
const SCROLLBACK_CAP = 256 * 1024; // bytes of raw terminal output kept per session

/** Metadata shape sent to the web app. */
export interface SessionMeta {
  id: string;
  name: string;
  color: string;
  cwd: string;
  shell: boolean;
  status: "running" | "exited";
  pid: number | null;
  createdAt: number;
  lastActive: number;
}

type Listener = (msg: ServerMessage) => void;

/**
 * One session = one long-lived PTY (Claude Code by default) that outlives any
 * particular WebSocket. It buffers recent output so a (re)attaching client can
 * replay scrollback instantly.
 */
class DenSession {
  term: pty.IPty | null = null;
  status: "running" | "exited" = "running";
  private buffer: string[] = [];
  private bufferBytes = 0;
  private listeners = new Set<Listener>();

  constructor(
    public id: string,
    public name: string,
    public color: string,
    public cwd: string,
    public shell: boolean,
    public createdAt: number,
    public lastActive: number,
  ) {}

  spawn() {
    const loginShell = process.env.SHELL ?? "/bin/zsh";
    const file = this.shell ? loginShell : CLAUDE_BIN;
    const args = this.shell ? [] : ["-n", this.name];
    const term = pty.spawn(file, args, {
      name: "xterm-color",
      cols: 80,
      rows: 24,
      cwd: this.cwd || os.homedir(),
      env: { ...process.env, TERM: "xterm-256color" },
    });
    this.term = term;
    this.status = "running";
    term.onData((data) => this.push(data));
    term.onExit(({ exitCode, signal }) => {
      this.status = "exited";
      this.term = null;
      this.emit({ type: "exit", code: exitCode, signal });
    });
  }

  private push(data: string) {
    this.buffer.push(data);
    this.bufferBytes += data.length;
    while (this.bufferBytes > SCROLLBACK_CAP && this.buffer.length > 1) {
      this.bufferBytes -= this.buffer.shift()!.length;
    }
    this.emit({ type: "output", data });
  }

  private emit(msg: ServerMessage) {
    for (const l of this.listeners) l(msg);
  }

  /** Register a client; synchronously returns the scrollback to replay first. */
  attach(listener: Listener): { scrollback: string; detach: () => void } {
    const scrollback = this.buffer.join("");
    this.listeners.add(listener);
    return {
      scrollback,
      detach: () => this.listeners.delete(listener),
    };
  }

  write(data: string) {
    this.term?.write(data);
    this.lastActive = Date.now();
  }

  resize(cols: number, rows: number) {
    if (!this.term) return;
    this.term.resize(
      Math.max(1, Math.floor(cols) || 80),
      Math.max(1, Math.floor(rows) || 24),
    );
  }

  kill() {
    try {
      this.term?.kill();
    } catch {
      // already dead
    }
  }

  meta(): SessionMeta {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      cwd: this.cwd,
      shell: this.shell,
      status: this.status,
      pid: this.term?.pid ?? null,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
    };
  }

  toRow(): SessionRow {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      cwd: this.cwd,
      shell: this.shell ? 1 : 0,
      claudeSessionId: null,
      status: this.status,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
    };
  }
}

const COLORS = ["#ffb7d5", "#cdb4f6", "#b8e6d4", "#b4d8f6", "#ffd9b0", "#fff0a8"];

class SessionManager {
  private sessions = new Map<string, DenSession>();
  private colorIdx = 0;

  /** Restore persisted rows as exited placeholders (live PTYs don't survive). */
  hydrate() {
    store.markAllExited();
    for (const row of store.all()) {
      const s = new DenSession(
        row.id,
        row.name,
        row.color,
        row.cwd,
        row.shell === 1,
        row.createdAt,
        row.lastActive,
      );
      s.status = "exited";
      this.sessions.set(s.id, s);
    }
  }

  create(opts: { name?: string; color?: string; cwd?: string; shell?: boolean }) {
    const id = randomUUID();
    const now = Date.now();
    const shell = opts.shell ?? false;
    const name = opts.name ?? (shell ? "shell" : `den-${this.sessions.size + 1}`);
    const color = opts.color ?? COLORS[this.colorIdx++ % COLORS.length];
    const cwd = opts.cwd || os.homedir();
    const s = new DenSession(id, name, color, cwd, shell, now, now);
    s.spawn();
    this.sessions.set(id, s);
    store.insert(s.toRow());
    return s.meta();
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()].map((s) => s.meta());
  }

  update(id: string, patch: { name?: string; color?: string }) {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (patch.name !== undefined) s.name = patch.name;
    if (patch.color !== undefined) s.color = patch.color;
    s.lastActive = Date.now();
    store.update(s.toRow());
    return s.meta();
  }

  remove(id: string) {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.kill();
    this.sessions.delete(id);
    store.delete(id);
    return true;
  }
}

export const sessions = new SessionManager();
