import * as pty from "node-pty";
import os from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { store, type SessionRow } from "./store.ts";
import type { ServerMessage } from "./ws-protocol.ts";

const CLAUDE_BIN = process.env.MC_CLAUDE_BIN ?? "claude";

/** Current git branch of a directory, or null if not a repo / detached. */
function gitBranch(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out && out !== "HEAD" ? out : null;
  } catch {
    return null;
  }
}

/** Parse a ticket id like "fast-6115" from a branch name (for ticket/PR links). */
function ticketHintFrom(branch: string | null): string | null {
  const m = branch?.match(/([a-z]+-\d+)/i);
  return m ? m[1].toLowerCase() : null;
}
const SCROLLBACK_CAP = 256 * 1024; // bytes of raw terminal output kept per session

// Per-workspace progress notepads live here (outside the project so we never
// pollute a repo). The main Claude is granted write access to this dir.
const PROGRESS_DIR = join(os.homedir(), ".den", "progress");
export const notepadPath = (groupId: string) =>
  join(PROGRESS_DIR, `${groupId}.md`);

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
  /** Workspace grouping. A Claude workspace = a "main" pane + a "shell" pane. */
  groupId: string;
  role: "main" | "shell";
  /** Git branch of the working dir (captured at start), and its ticket hint. */
  branch: string | null;
  ticketHint: string | null;
  /** The session rang the bell while unwatched — it wants your attention. */
  attention: boolean;
  /** Linear ticket this workspace is for (identifier, e.g. "FAST-6115"). */
  ticket: string | null;
  /** A lightweight "just looking" session: ticket viewer + one Claude pane. */
  look: boolean;
  /** Special GitHub PR layout: "review" (others' PR) or "mypr" (your own). */
  view: "review" | "mypr" | null;
  /** The GitHub PR this session is for (number + nameWithOwner repo). */
  pr: number | null;
  prRepo: string | null;
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
  /** Once the user renames, stop auto-updating the title from the terminal. */
  titleLocked = false;
  private oscCarry = "";
  /** Set when the terminal rings the bell while unwatched (Claude wants input). */
  attention = false;

  /** Overrides the default spawn args (used for the main Claude of a workspace). */
  spawnArgs: string[] | null = null;
  /** Git branch of the working dir, captured when the session starts. */
  branch: string | null = null;
  /** Linear ticket identifier this workspace is for, if any. */
  ticket: string | null = null;
  /** Whether this is a lightweight "just looking" session. */
  look = false;
  /** GitHub PR view mode + which PR, if this is a PR session. */
  view: "review" | "mypr" | null = null;
  pr: number | null = null;
  prRepo: string | null = null;

  constructor(
    public id: string,
    public name: string,
    public color: string,
    public cwd: string,
    public shell: boolean,
    public createdAt: number,
    public lastActive: number,
    public groupId: string,
    public role: "main" | "shell",
  ) {}

  spawn() {
    const loginShell = process.env.SHELL ?? "/bin/zsh";
    const file = this.shell ? loginShell : CLAUDE_BIN;
    const args = this.spawnArgs ?? (this.shell ? [] : ["-n", this.name]);
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
    // A bell while nobody's watching = this session wants your attention.
    if (this.listeners.size === 0 && data.includes("\u0007")) {
      this.attention = true;
    }
    this.maybeTitle(data);
    this.emit({ type: "output", data });
  }

  /**
   * Terminals (incl. Claude Code) announce their title with an OSC escape:
   * ESC ] 0|1|2 ; <title> BEL (or ST). Pick up the latest one and use it as the
   * session name — Claude sets this once it has a sense of the topic. Skipped
   * once the user has renamed manually (titleLocked).
   */
  private maybeTitle(chunk: string) {
    // Only Claude sessions auto-title (it sets a topic-based title). Shells set
    // the title to the cwd/command on every prompt, which just flaps — those
    // keep their given name and can still be renamed by hand.
    if (this.shell || this.titleLocked) return;
    const data = this.oscCarry + chunk;
    const re = /\x1b\][012];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let m: RegExpExecArray | null;
    let latest: string | null = null;
    while ((m = re.exec(data))) latest = m[1];

    // Carry a trailing, not-yet-terminated OSC across chunk boundaries.
    const open = data.lastIndexOf("\x1b]");
    this.oscCarry =
      open !== -1 && !/[\x07]|\x1b\\/.test(data.slice(open))
        ? data.slice(open).slice(-512)
        : "";

    if (latest === null) return;
    const title = latest.trim().replace(/\s+/g, " ").slice(0, 60);
    if (title && title !== this.name) {
      this.name = title;
      this.lastActive = Date.now();
      store.update(this.toRow());
      this.emit({ type: "title", name: title });
    }
  }

  /** Lock the title (user renamed) so the terminal can't override it. */
  lockTitle() {
    this.titleLocked = true;
  }

  private emit(msg: ServerMessage) {
    for (const l of this.listeners) l(msg);
  }

  /** Register a client; synchronously returns the scrollback to replay first. */
  attach(listener: Listener): { scrollback: string; detach: () => void } {
    this.attention = false; // viewing it clears the nudge
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
      groupId: this.groupId,
      role: this.role,
      branch: this.branch,
      ticketHint: ticketHintFrom(this.branch),
      attention: this.attention,
      ticket: this.ticket,
      look: this.look,
      view: this.view,
      pr: this.pr,
      prRepo: this.prRepo,
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
      groupId: this.groupId,
      role: this.role,
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
        row.groupId ?? row.id,
        (row.role as "main" | "shell") ?? "main",
      );
      s.status = "exited";
      this.sessions.set(s.id, s);
    }
  }

  private resolveCwd(cwd?: string) {
    const documents = join(os.homedir(), "Documents");
    return cwd || (existsSync(documents) ? documents : os.homedir());
  }

  private spawnSession(s: DenSession) {
    s.spawn();
    this.sessions.set(s.id, s);
    store.insert(s.toRow());
  }

  /**
   * Create a workspace and return its "main" session.
   * - shell: a single plain terminal (main pane only).
   * - claude: a main Claude pane + a sibling shell pane in the same folder, plus
   *   a progress notepad the main Claude is told to keep.
   */
  create(opts: {
    name?: string;
    color?: string;
    cwd?: string;
    shell?: boolean;
    resumeId?: string;
    ticket?: string;
    look?: boolean;
    notepadSeed?: string;
    view?: "review" | "mypr";
    pr?: number;
    prRepo?: string;
    initialPrompt?: string;
  }) {
    const now = Date.now();
    const shell = opts.shell ?? false;
    const color = opts.color ?? COLORS[this.colorIdx++ % COLORS.length];
    const cwd = this.resolveCwd(opts.cwd);
    const groupId = randomUUID();
    const branch = gitBranch(cwd);

    if (shell) {
      const name = opts.name ?? "shell";
      const s = new DenSession(
        groupId, name, color, cwd, true, now, now, groupId, "main",
      );
      s.branch = branch;
      this.spawnSession(s);
      return s.meta();
    }

    // Single-pane Claude sessions: "just looking" at a ticket, or a GitHub PR
    // review / your-own-PR view. (No shell/notepad — the layout is specialised.)
    if (opts.look || opts.view) {
      const name =
        opts.name ?? opts.ticket ?? (opts.pr ? `PR #${opts.pr}` : "look");
      const s = new DenSession(
        groupId, name, color, cwd, false, now, now, groupId, "main",
      );
      s.spawnArgs = ["-n", name];
      s.branch = branch;
      s.ticket = opts.ticket ?? null;
      s.look = !!opts.look;
      s.view = opts.view ?? null;
      s.pr = opts.pr ?? null;
      s.prRepo = opts.prRepo ?? null;
      this.spawnSession(s);
      return s.meta();
    }

    // Claude workspace: main pane + shell pane + notepad.
    const name = opts.name ?? `den-${this.sessions.size + 1}`;
    const file = this.ensureNotepad(groupId, opts.notepadSeed);
    const instruction =
      `You're working in a project inside a tool called "den". Keep a running ` +
      `progress log for the developer at the absolute path ${file}. After each ` +
      `meaningful step — a decision, an edit, a completed task, or a blocker — ` +
      `append a short timestamped bullet to that file describing what you did. ` +
      `Keep entries concise and skimmable and never delete earlier ones. This ` +
      `file is shown to the developer in a side notepad; don't mention this ` +
      `logging in your replies.`;

    const main = new DenSession(
      randomUUID(), name, color, cwd, false, now, now, groupId, "main",
    );
    main.spawnArgs = [
      ...(opts.resumeId ? ["--resume", opts.resumeId] : ["-n", name]),
      "--add-dir", PROGRESS_DIR,
      "--append-system-prompt", instruction,
      // An initial prompt (e.g. the ticket) becomes Claude's first message.
      ...(opts.initialPrompt && !opts.resumeId ? [opts.initialPrompt] : []),
    ];
    main.branch = branch;
    main.ticket = opts.ticket ?? null;
    this.spawnSession(main);

    const term = new DenSession(
      randomUUID(), "terminal", color, cwd, true, now, now, groupId, "shell",
    );
    term.branch = branch;
    this.spawnSession(term);

    return main.meta();
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
    if (patch.name !== undefined) {
      s.name = patch.name;
      s.lockTitle(); // manual rename wins over terminal-set titles
    }
    // Recolour the whole workspace so panes stay visually grouped.
    if (patch.color !== undefined) {
      for (const other of this.sessions.values()) {
        if (other.groupId === s.groupId) {
          other.color = patch.color;
          store.update(other.toRow());
        }
      }
    }
    s.lastActive = Date.now();
    store.update(s.toRow());
    return s.meta();
  }

  /** Remove the whole workspace the given session belongs to. */
  remove(id: string) {
    const s = this.sessions.get(id);
    if (!s) return false;
    for (const other of [...this.sessions.values()]) {
      if (other.groupId === s.groupId) {
        other.kill();
        this.sessions.delete(other.id);
        store.delete(other.id);
      }
    }
    return true;
  }

  // --- Progress notepad ---
  private ensureNotepad(groupId: string, seed?: string): string {
    mkdirSync(PROGRESS_DIR, { recursive: true });
    const file = notepadPath(groupId);
    if (!existsSync(file)) {
      writeFileSync(file, seed ?? "# Progress\n\n");
    }
    return file;
  }

  readNotepad(groupId: string): string {
    try {
      return readFileSync(notepadPath(groupId), "utf8");
    } catch {
      return "";
    }
  }

  writeNotepad(groupId: string, content: string) {
    mkdirSync(PROGRESS_DIR, { recursive: true });
    writeFileSync(notepadPath(groupId), content);
  }
}

export const sessions = new SessionManager();
