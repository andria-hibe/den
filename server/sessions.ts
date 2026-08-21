import * as pty from "node-pty";
import os from "node:os";
import { join } from "node:path";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { store, type SessionRow } from "./store.ts";
import { hasSession, latestSessionForCwd } from "./discover.ts";
import { logWarn } from "./log.ts";
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

// groupIds are randomUUIDs. Validate before building a path so a crafted id
// (e.g. "../../etc/foo") can't escape PROGRESS_DIR into arbitrary file read/write.
const GROUP_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
export function isValidGroupId(groupId: string): boolean {
  return GROUP_ID_RE.test(groupId);
}
export const notepadPath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(PROGRESS_DIR, `${groupId}.md`);
};

// PR-review sessions get their own guardrails (see buildReviewPermissions).
// The PR's diff and the per-session permission settings file live here, outside
// any repo. Both are cleaned up when the workspace is closed.
const REVIEW_DIR = join(os.homedir(), ".den", "review");
const reviewDiffPath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(REVIEW_DIR, `${groupId}.diff`);
};
const reviewSettingsPath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(REVIEW_DIR, `${groupId}.settings.json`);
};

/** The Claude permission rules for a PR-review pane.
 *
 * A review pane has a **shell and can edit files** — reviewing a PR properly
 * means running the tests, bisecting a suspicion, trying a fix. What it must
 * never do is change the PR: the primary guard is the instruction
 * (`reviewInstruction` — no commits, no pushes, edits only on a scratch branch),
 * and these deny rules are the backstop under it, blocking the direct path to
 * anything that leaves this machine or rewrites history:
 *  - `git push` / `git commit` in any form (the prefix covers flags/subargs);
 *  - the `gh` subcommands that write to the PR, the repo, or the issue tracker,
 *    while `gh pr view|diff|checks` stay available for reading;
 *  - `gh api`, which can POST anything.
 * They are a backstop, not a sandbox: a deny can't be prompted past, but a
 * determined shell can still reach the same place by another route (a wrapper
 * script, `git -C`, an alias). The instruction does the real work.
 *
 * The `allow` list is the notepad (so the finished review saves without a
 * prompt) plus the commands a review runs constantly that are read-only toward
 * the repo and GitHub: `git log/show/diff/status/blame/grep/fetch`, `rg`/`grep`,
 * and the `gh pr view|diff|checks` reads. Without these, the code-review
 * skill's finding pass stalls on a prompt for every `git show` (seen live
 * 2026-08-22). `git fetch` is included: it only updates local refs, and a
 * review often needs it to compare a stale worktree against the PR head.
 * Deny beats allow in Claude's permission rules, so none of this loosens the
 * push/commit/gh-write backstop. Everything else follows den's normal
 * permission behaviour (`--permission-mode default`), i.e. Claude asks before
 * it acts, exactly like any other pane.
 *
 * Pure (no I/O) so it's unit-testable. `notepadAbs` must be absolute; it's
 * emitted as Claude's "//<path>" root-anchored specifier. */
export function buildReviewPermissions(notepadAbs: string) {
  const root = (p: string) => "//" + p.replace(/^\/+/, "");
  return {
    permissions: {
      deny: [
        "Bash(git push:*)",
        "Bash(git commit:*)",
        "Bash(gh pr merge:*)",
        "Bash(gh pr review:*)",
        "Bash(gh pr comment:*)",
        "Bash(gh pr edit:*)",
        "Bash(gh pr close:*)",
        "Bash(gh pr reopen:*)",
        "Bash(gh pr ready:*)",
        "Bash(gh issue comment:*)",
        "Bash(gh api:*)",
      ],
      allow: [
        `Edit(${root(notepadAbs)})`,
        "Bash(git log:*)",
        "Bash(git show:*)",
        "Bash(git diff:*)",
        "Bash(git status:*)",
        "Bash(git blame:*)",
        "Bash(git grep:*)",
        "Bash(git fetch:*)",
        "Bash(rg:*)",
        "Bash(grep:*)",
        "Bash(gh pr view:*)",
        "Bash(gh pr diff:*)",
        "Bash(gh pr checks:*)",
      ],
    },
  };
}

/** Where a review session must put any change it needs to make, so the PR's own
 * branch never carries den's edits. */
export function scratchBranch(branch: string | null | undefined): string {
  return `andria/changes-to-${branch || "this-pr"}`;
}

/** The system-prompt instruction telling the main Claude to log progress to its
 * workspace notepad. Shared by create() and restart() so a restarted workspace
 * keeps its progress-logging wiring. */
function progressInstruction(file: string): string {
  return (
    `You're working in a project inside a tool called "den". Keep a running ` +
    `progress log for the developer at the absolute path ${file}. After each ` +
    `meaningful step — a decision, an edit, a completed task, or a blocker — ` +
    `append a short timestamped bullet to that file describing what you did. ` +
    `Keep entries concise and skimmable and never delete earlier ones. This ` +
    `file is shown to the developer in a side notepad; don't mention this ` +
    `logging in your replies.`
  );
}

/** System-prompt instruction for a PR-review pane. The session has a full shell
 * (see buildReviewPermissions), so the rules that keep it from touching the PR
 * live here: never commit, never push, and any change it needs to make goes on a
 * local scratch branch. It reads the diff from a file den provides and saves its
 * review to the notepad, which den renders beside the diff. Shared by create()
 * and restart() so the wiring survives a restart.
 *
 * It also fixes the *shape* of the review, because the developer copies these
 * comments straight into GitHub:
 * - **Plain ASCII only.** An em dash or a curly quote survives a copy-paste as a
 *   character that reads as mojibake in some boxes and breaks a code snippet in
 *   others. The instruction below is itself ASCII-only for the same reason -- an
 *   instruction full of em dashes teaches the model to write them back.
 *   The `isAscii` test guards that.
 * - **Short, ranked, actionable bullets.** One issue per bullet, "path:line"
 *   first, five bullets per file, worst first, no praise or recap. Shaped for a
 *   reader who acts off the first line of each bullet -- Claude Code's built-in
 *   "Concise" style plus the `i-have-adhd` skill, both of which andria runs.
 *   Note the "just as thoroughly" clause: Concise makes the *writing* terse, not
 *   the review. Do not let a later edit turn the bullet cap into a reading cap.
 *
 * The finding pass runs through Claude Code's built-in code-review skill
 * (adversarially verified findings, ranked worst-first) targeted at the PR's
 * branch, with --comment and --fix explicitly forbidden (--comment posts to
 * GitHub; --fix edits the working tree). The skill is a first pass, not the
 * review: its report renders only in the terminal, so the instruction tells the
 * session to fold the findings into the notepad and cover what the skill's
 * correctness/simplification scope misses.
 */
export function reviewInstruction(
  notepad: string,
  diffFile: string,
  branch: string | null | undefined,
): string {
  const scratch = scratchBranch(branch);
  return (
    `You're reviewing a GitHub pull request inside a tool called "den". It's ` +
    `someone else's work and your job is to review it, not to change it. You have ` +
    `a full shell and can run anything you need to understand the change: the ` +
    `tests, a build, git history, gh reads. But these rules are absolute:\n` +
    `1. NEVER commit. Not on the PR's branch, not anywhere.\n` +
    `2. NEVER push, and never post anything to GitHub. No \`git push\`, no ` +
    `\`gh pr review\`/\`comment\`/\`merge\`/\`edit\`, no \`gh api\` writes. Your ` +
    `review goes in the notepad file named below and nowhere else; the developer ` +
    `decides what, if anything, reaches GitHub.\n` +
    `3. If you need to change files, to test a fix, reproduce a bug, or check a ` +
    `suspicion, first move off the PR's branch: \`git checkout -b ${scratch}\` ` +
    `(or \`git checkout ${scratch}\` if it already exists), then edit there. Keep ` +
    `it local and uncommitted, and say so in your review rather than leaving it ` +
    `as a surprise. Never leave the PR's own branch modified.\n` +
    `The PR's full unified diff is saved at ${diffFile}; read that first, then ` +
    `read the changed files in your working directory for surrounding context. ` +
    `Start the finding pass by running Claude Code's built-in code-review skill ` +
    `at high effort against this PR's ` +
    (branch ? `branch (${branch})` : `checked-out branch`) +
    `; it hunts correctness bugs and verifies its findings before reporting. ` +
    `Never pass --comment (posts to GitHub) or --fix (edits the working tree). ` +
    `Its report renders in the terminal only and is not the deliverable: fold ` +
    `the verified findings into the notepad review described next, and cover ` +
    `yourself what its scope misses (design, tests, naming, missing cases). If ` +
    `the skill is unavailable, do the whole review by hand.\n` +
    `Save your finished review as markdown to the absolute path ${notepad} ` +
    `(create or overwrite it). That file is where the review lives. den splits ` +
    `that file up and renders each file's comments next to that file's diff, so ` +
    `structure it exactly like this: first the general review (a two or three ` +
    `line summary, then any cross-cutting risk), then one "## <file path>" ` +
    `heading per file you have comments on, the path exactly as it appears after ` +
    `"b/" in the diff's "diff --git" line, followed by that file's comments as ` +
    `bullets. Put nothing but that file's comments under its heading, and skip ` +
    `files you have nothing to say about.\n` +
    `WRITE THE WHOLE REVIEW IN PLAIN ASCII. The developer copies these comments ` +
    `straight into GitHub, so every character must survive a copy-paste. Use "-" ` +
    `for a dash, "'" for an apostrophe, '"' for a quote, "->" for an arrow, and ` +
    `"..." for an ellipsis. Never write an em dash, an en dash, a curly quote, a ` +
    `curly apostrophe, a real arrow, a non-breaking space, box drawing, or an ` +
    `emoji. If a line you quote from the diff already holds a non-ASCII ` +
    `character, keep it inside a code span, but never add one of your own.\n` +
    `KEEP THE WRITING SHORT AND DIRECT WHILE DOING THE REVIEW JUST AS ` +
    `THOROUGHLY. Read as widely as the change needs; it is the prose that is ` +
    `terse, never the work behind it. Lead with the result and skip preamble ` +
    `and narration. One issue per bullet, one or two sentences. Open the bullet ` +
    `with "path:line" (or "path:start-end"), then the problem, then the fix. Say ` +
    `what to change, not how you feel about it. Give each file at most 5 ` +
    `bullets, worst first; if a file has more, keep the top 5 and add one bullet ` +
    `naming what you left out. No praise, no preamble, no closing recap, no ` +
    `hedging adverbs. A file you are happy with gets no heading at all.\n` +
    `Write the clean, finished review there, not a running log; don't mention ` +
    `these files in your replies.`
  );
}

/** True if `s` is pure 7-bit ASCII (tab and newline allowed). The review
 * instruction and the review it asks for must both pass this: see
 * reviewInstruction. Exported for the test. */
export function isAscii(s: string): boolean {
  return !/[^\t\n\x20-\x7e]/.test(s);
}

/**
 * Does a PTY look ready to receive scripted input? True once it has produced
 * some output and then gone quiet — i.e. the TUI has finished drawing and isn't
 * mid-response.
 *
 * This matters because Claude's TUI **drops input that arrives while it's still
 * starting up**: measured against a real session, a paste 6s after spawn vanished
 * without trace while the same paste at 12s landed. A fixed delay is therefore a
 * guess that silently loses the prompt on a slow start, which is why anything den
 * sends on its own (the pre-review) waits for this instead.
 *
 * `lastOutputAt` of 0 means nothing has been emitted yet — still booting, so not
 * ready (never "idle since forever").
 */
export function ptyLooksIdle(
  lastOutputAt: number,
  now: number,
  idleMs: number,
): boolean {
  if (!lastOutputAt) return false;
  return now - lastOutputAt >= idleMs;
}

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
  /** When the PTY last emitted output; 0 = nothing yet. Drives `waitUntilIdle`. */
  private lastOutputAt = 0;
  /** New output since the last scrollback flush to the store. */
  private scrollbackDirty = false;
  private listeners = new Set<Listener>();
  /** Once the user renames, stop auto-updating the title from the terminal. */
  titleLocked = false;
  private oscCarry = "";
  /** Set when the terminal rings the bell while unwatched (Claude wants input). */
  attention = false;

  /** Overrides the default spawn args (used for the main Claude of a workspace). */
  spawnArgs: string[] | null = null;
  /** The Claude conversation id this pane owns (pinned via `--session-id` at
   * spawn), so a restart can `--resume` the *same* conversation rather than
   * starting a blank one. Null for shells and pre-existing rows. */
  claudeSessionId: string | null = null;
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
    let term: pty.IPty;
    try {
      term = pty.spawn(file, args, {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: this.cwd || os.homedir(),
        env: { ...process.env, TERM: "xterm-256color" },
      });
    } catch (err) {
      // Missing binary (e.g. `claude`/shell not on PATH) or a bad cwd: don't let
      // it crash the create-session request — surface the pane as exited so the
      // UI can show it failed instead of the whole server falling over.
      logWarn(`pty.spawn ${file}`, err);
      this.status = "exited";
      this.term = null;
      this.emit({ type: "exit", code: null });
      return;
    }
    this.term = term;
    this.status = "running";
    term.onData((data) => this.push(data));
    term.onExit(({ exitCode, signal }) => {
      this.status = "exited";
      this.term = null;
      this.persistScrollback(); // keep the final output across a restart
      this.emit({ type: "exit", code: exitCode, signal });
    });
  }

  private push(data: string) {
    this.buffer.push(data);
    this.bufferBytes += data.length;
    this.lastOutputAt = Date.now();
    this.scrollbackDirty = true;
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

  /**
   * Wait until the PTY looks ready for scripted input (see `ptyLooksIdle`), so a
   * paste den sends itself isn't swallowed by a TUI that's still drawing. Returns
   * whether it settled; on timeout the caller can still go ahead (a lost paste is
   * no worse than not trying). Already-idle sessions return immediately.
   */
  async waitUntilIdle(idleMs = 800, timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.status === "exited") return false;
      if (ptyLooksIdle(this.lastOutputAt, Date.now(), idleMs)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
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
      claudeSessionId: this.claudeSessionId,
      status: this.status,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
      groupId: this.groupId,
      role: this.role,
      branch: this.branch,
      ticket: this.ticket,
      look: this.look ? 1 : 0,
      view: this.view,
      pr: this.pr,
      prRepo: this.prRepo,
      titleLocked: this.titleLocked ? 1 : 0,
      // Scrollback is persisted separately (store.setScrollback), not on this
      // metadata path — a fresh row starts empty.
      scrollback: null,
    };
  }

  /** Restore persisted scrollback so an attaching client replays it after a
   * server restart (the live PTY is gone, but its output history survives). */
  restoreScrollback(text: string) {
    this.buffer = [text];
    this.bufferBytes = text.length;
  }

  /** Drop the scrollback (used on restart — the re-spawned process starts fresh). */
  clearBuffer() {
    this.buffer = [];
    this.bufferBytes = 0;
    this.scrollbackDirty = true;
  }

  /** Write the current scrollback to the store if it changed since last flush. */
  persistScrollback() {
    if (!this.scrollbackDirty) return;
    this.scrollbackDirty = false;
    store.setScrollback(this.id, this.buffer.join(""));
  }
}

// 9 pastels spread across the hue wheel (kept in sync with web/src/App.tsx's
// picker). New sessions cycle through these for an easy-to-distinguish colour.
const COLORS = [
  "#ffb2d8", // pink
  "#ffcaa3", // peach
  "#f7e79c", // yellow
  "#c9e9a0", // lime
  "#a5e6c4", // mint
  "#a2dfe8", // aqua
  "#abc9f6", // sky
  "#bcb8f6", // periwinkle
  "#d7b3f4", // violet
];

// How often to flush changed scrollback to the store. A crash loses at most
// this much recent output; keeping it coarse avoids constant disk writes.
const SCROLLBACK_FLUSH_MS = 5000;

class SessionManager {
  private sessions = new Map<string, DenSession>();
  private colorIdx = 0;

  constructor() {
    // Periodically persist any session whose scrollback changed, so a restart
    // can replay recent output instead of showing an empty pane.
    const timer = setInterval(() => {
      for (const s of this.sessions.values()) s.persistScrollback();
    }, SCROLLBACK_FLUSH_MS);
    // Don't keep the process alive just for this (CLI/tests exit cleanly).
    timer.unref?.();
  }

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
      s.claudeSessionId = row.claudeSessionId ?? null;
      s.branch = row.branch ?? null;
      s.ticket = row.ticket ?? null;
      s.look = row.look === 1;
      s.view = (row.view as "review" | "mypr" | null) ?? null;
      s.pr = row.pr ?? null;
      s.prRepo = row.prRepo ?? null;
      s.titleLocked = row.titleLocked === 1;
      if (row.scrollback) s.restoreScrollback(row.scrollback);
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
    /** The PR's unified diff, for a review pane's read-only diff file. */
    reviewDiff?: string;
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
      s.claudeSessionId = randomUUID();
      // A "review" pane keeps a workspace notepad: Claude saves its finished
      // review there and den renders it beside the diff (and it's a record for
      // the developer). Seeded empty so the review column shows its prompt until
      // Claude writes. Other single-pane views (look / mypr) don't.
      if (opts.view === "review") {
        const file = this.ensureNotepad(groupId, "");
        const diffFile = this.ensureReviewDiff(groupId, opts.reviewDiff);
        const settingsFile = this.ensureReviewPerms(groupId);
        s.spawnArgs = [
          "--session-id", s.claudeSessionId, "-n", name,
          // The pane has a normal shell; the settings file carries the deny
          // backstop (no push/commit/gh writes) and the notepad allow.
          // --permission-mode default keeps the deny rules in force.
          "--settings", settingsFile,
          "--permission-mode", "default",
          "--add-dir", PROGRESS_DIR,
          "--add-dir", REVIEW_DIR,
          "--append-system-prompt", reviewInstruction(file, diffFile, branch),
        ];
      } else {
        s.spawnArgs = ["--session-id", s.claudeSessionId, "-n", name];
      }
      s.branch = branch;
      s.ticket = opts.ticket ?? null;
      s.look = !!opts.look;
      s.view = opts.view ?? null;
      s.pr = opts.pr ?? null;
      s.prRepo = opts.prRepo ?? null;
      // Keep the descriptive ticket/PR title — don't let the terminal retitle it.
      if (opts.ticket || opts.pr) s.titleLocked = true;
      this.spawnSession(s);
      return s.meta();
    }

    // Claude workspace: main pane + shell pane + notepad.
    const name = opts.name ?? `den-${this.sessions.size + 1}`;
    const file = this.ensureNotepad(groupId, opts.notepadSeed);
    const instruction = progressInstruction(file);

    const main = new DenSession(
      randomUUID(), name, color, cwd, false, now, now, groupId, "main",
    );
    // Pin the conversation id (or adopt the one we're resuming) so a later
    // restart can bring back THIS exact conversation.
    main.claudeSessionId = opts.resumeId ?? randomUUID();
    main.spawnArgs = [
      ...(opts.resumeId
        ? ["--resume", opts.resumeId]
        : ["--session-id", main.claudeSessionId, "-n", name]),
      "--add-dir", PROGRESS_DIR,
      "--append-system-prompt", instruction,
      // An initial prompt (e.g. the ticket) becomes Claude's first message. The
      // `--` end-of-options separator means a prompt starting with "-" is read as
      // the positional prompt, never as a flag (arg-injection guard).
      ...(opts.initialPrompt && !opts.resumeId ? ["--", opts.initialPrompt] : []),
    ];
    main.branch = branch;
    main.ticket = opts.ticket ?? null;
    // Keep the ticket title as the session name (don't let Claude retitle it).
    if (opts.ticket) main.titleLocked = true;
    this.spawnSession(main);

    const term = new DenSession(
      randomUUID(), "terminal", color, cwd, true, now, now, groupId, "shell",
    );
    term.branch = branch;
    this.spawnSession(term);

    return main.meta();
  }

  /**
   * Add another shell pane to an existing workspace (a new "shell" tab). The
   * new terminal inherits the group's cwd / colour / branch. Returns its meta,
   * or null if the group has no sessions.
   */
  addShell(groupId: string): SessionMeta | null {
    const sibling = [...this.sessions.values()].find(
      (s) => s.groupId === groupId,
    );
    if (!sibling) return null;
    const now = Date.now();
    const term = new DenSession(
      randomUUID(), "terminal", sibling.color, sibling.cwd, true, now, now,
      groupId, "shell",
    );
    term.branch = sibling.branch;
    this.spawnSession(term);
    return term.meta();
  }

  /**
   * Re-spawn an exited session's PTY in place, keeping its cwd/name/colour/
   * branch/ticket/PR context — so an exited pane (e.g. after den was closed and
   * reopened, when live PTYs don't survive) can be brought back to life without
   * losing its identity. Args are rebuilt from the persisted context rather than
   * reused, so restart never re-injects a one-time initial prompt. Returns the
   * refreshed meta, or null if the session is unknown or already running.
   */
  restart(id: string): SessionMeta | null {
    const s = this.sessions.get(id);
    if (!s || s.status === "running") return null;
    // Rebuild claude args from context (shells fall back to the login shell).
    s.spawnArgs = s.shell ? null : this.restartArgs(s);
    s.clearBuffer(); // fresh terminal — the exited scrollback was just history
    s.spawn();
    store.update(s.toRow());
    return s.meta();
  }

  /** Claude spawn args for a restart, rebuilt from the session's context. A
   * workspace main keeps its progress-notepad wiring; look/PR panes just get the
   * resume args. (No initial prompt — that's a one-time create-only thing.) */
  private restartArgs(s: DenSession): string[] {
    const resume = this.resumeArgs(s);
    if (s.role === "main" && !s.look && !s.view) {
      mkdirSync(PROGRESS_DIR, { recursive: true });
      const file = notepadPath(s.groupId);
      return [
        ...resume,
        "--add-dir", PROGRESS_DIR,
        "--append-system-prompt", progressInstruction(file),
      ];
    }
    // A review pane keeps its guardrails + notepad wiring so a revived review
    // still won't commit/push the PR and still saves (and shows) its review.
    if (s.view === "review") {
      mkdirSync(PROGRESS_DIR, { recursive: true });
      const file = notepadPath(s.groupId);
      const diffFile = this.ensureReviewDiff(s.groupId);
      const settingsFile = this.ensureReviewPerms(s.groupId);
      return [
        ...resume,
        "--settings", settingsFile,
        "--permission-mode", "default",
        "--add-dir", PROGRESS_DIR,
        "--add-dir", REVIEW_DIR,
        "--append-system-prompt", reviewInstruction(file, diffFile, s.branch),
      ];
    }
    return resume;
  }

  /** Pick which conversation a restarting Claude pane reopens:
   *  1. its own pinned session, if that transcript still exists → `--resume`;
   *  2. else the newest conversation recorded in this cwd (covers panes created
   *     before den pinned ids, e.g. after a close/reopen) → `--resume`, adopting
   *     that id so future restarts are unambiguous;
   *  3. else nothing to resume → start fresh, pinning a new id so the next
   *     restart of this pane can resume it. */
  private resumeArgs(s: DenSession): string[] {
    if (s.claudeSessionId && hasSession(s.claudeSessionId)) {
      return ["--resume", s.claudeSessionId];
    }
    const latest = latestSessionForCwd(s.cwd);
    if (latest) {
      s.claudeSessionId = latest;
      return ["--resume", latest];
    }
    s.claudeSessionId = randomUUID();
    return ["--session-id", s.claudeSessionId, "-n", s.name];
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

  /**
   * Remove a single session (one shell tab), leaving the rest of its workspace
   * intact. Refuses to remove a "main" pane — closing that means closing the
   * whole workspace (use remove()). Returns false if not found / not allowed.
   */
  removeOne(id: string) {
    const s = this.sessions.get(id);
    if (!s || s.role !== "shell") return false;
    s.kill();
    this.sessions.delete(id);
    store.delete(id);
    return true;
  }

  /** Remove the whole workspace the given session belongs to. */
  remove(id: string) {
    const s = this.sessions.get(id);
    if (!s) return false;
    const groupId = s.groupId;
    for (const other of [...this.sessions.values()]) {
      if (other.groupId === groupId) {
        other.kill();
        this.sessions.delete(other.id);
        store.delete(other.id);
      }
    }
    // The progress notepad is scoped to this workspace — closing the workspace
    // deletes it too, so ~/.den/progress doesn't fill with orphaned notes. (Mere
    // exit/restart keeps it, since the session lives on and can be revived.)
    try {
      rmSync(notepadPath(groupId), { force: true });
      // Review panes also leave a diff + settings file behind — clear those too.
      rmSync(reviewDiffPath(groupId), { force: true });
      rmSync(reviewSettingsPath(groupId), { force: true });
    } catch {
      // invalid id / already gone — nothing to clean up
    }
    return true;
  }

  // --- PR-review guardrails ---

  /** Write the PR's diff to a file the review session can read, so the whole
   * change is in front of it without a `gh pr diff` round-trip. Pass `diff` on
   * create; omit on restart to keep whatever was captured before. Returns the
   * file path. */
  private ensureReviewDiff(groupId: string, diff?: string): string {
    mkdirSync(REVIEW_DIR, { recursive: true });
    const file = reviewDiffPath(groupId);
    if (diff != null) writeFileSync(file, diff);
    else if (!existsSync(file)) writeFileSync(file, "");
    return file;
  }

  /** Write a per-session Claude settings file carrying a review pane's deny
   * backstop + notepad allow (see buildReviewPermissions) and return its path,
   * for `--settings`. */
  private ensureReviewPerms(groupId: string): string {
    mkdirSync(REVIEW_DIR, { recursive: true });
    const settings = buildReviewPermissions(notepadPath(groupId));
    const file = reviewSettingsPath(groupId);
    writeFileSync(file, JSON.stringify(settings, null, 2));
    return file;
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
