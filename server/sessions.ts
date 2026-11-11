import * as pty from "node-pty";
import os from "node:os";
import { join } from "node:path";
import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync, statSync,
} from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { COLORS } from "../shared/colors.ts";
import {
  HANDOVER_LONG_CHARS, HANDOVER_TEMPLATE, canStartFresh, handoverLength,
  lineChanges, restoreTicket,
  ticketDescription, waitingItems, worksLikeWorkspace,
} from "../shared/handover.ts";
import { store, type SessionRow } from "./store.ts";
import { developerSections, type DigestSession } from "./digest.ts";
import { compactions, contextSize } from "./usage.ts";
import { mergeHooks, readTurn, removeTurn, turnHooks, watchTurns, type Turn } from "./turnState.ts";
import { guideRisk, type GuideRisk } from "../shared/guideRisk.ts";
import { CHECKS_DIR, checkResultPath } from "./doneCheck.ts";

/** The directory panes save check results to, made on first use. */
function ensureChecksDir(): string {
  mkdirSync(CHECKS_DIR, { recursive: true });
  return CHECKS_DIR;
}
import { RECENT_MS, assess, burners, currentWatch, noteReading, setWatch, type Watch } from "./fieldMouse.ts";
import { createHash } from "node:crypto";
import { setupHint } from "./apprun.ts";
import {
  readLimits, readPaneContext, removeLimits, statusLineSettings, type PaneContext, type PlanLimits,
} from "./limits.ts";
import { inboxHooks, removeInbox, tellPane } from "./inbox.ts";
import { waitingChangeMessage } from "./manager.ts";
import { activeCrew, clearCrew, crewHooks, removeCrewRuns } from "./crewActivity.ts";
import { recordChecks, type CheckSource } from "./checkLog.ts";
import { stackStatus, type StackStatus, type StackTarget } from "./stack.ts";
import { repoBaseName } from "./git.ts";
import { workDir } from "./fs.ts";
import { hasSession, latestSessionForCwd, sessionMtime } from "./discover.ts";
import { parseTicketHint } from "./github.ts";
import { logWarn } from "./log.ts";
import type { ServerMessage } from "./ws-protocol.ts";
import { DATA_DIR } from "./dataDir.ts";
import { paneTheme, themeFromArgs, type PaneTheme } from "./paneTheme.ts";
import {
  DIGEST_PATH, MANAGER_DIR, MANAGER_NAME, PROGRESS_DIR, TODAY_PATH,
} from "./paths.ts";
import {
  buildManagerPermissions, buildReviewPermissions, commentRules, denIssueRule, denWatchRule, houseRules,
  idleHandoverPrompt, lookInstruction, managerInstruction, myPrInstruction, progressInstruction,
  reviewInstruction, testingRules, ticketDiscussionRule, workspaceInstruction,
} from "./instructions.ts";
import { crewRule, fableHasRoom, kitAgents, managerAgents, reviewAgents } from "./crew.ts";

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

const SCROLLBACK_CAP = 256 * 1024; // characters of terminal output kept per session


/** The OSC titles (ESC ] 0|1|2 ; <title> BEL or ST) in a chunk of pane
 * output, and whether it rang a bell outside any OSC sequence: Claude Code
 * ends its title and hyperlink sequences with BEL, so a bare search for BEL
 * fires on every spinner frame. `carry` is an unterminated OSC to prepend to
 * the next chunk. */
export function scanOsc(carry: string, chunk: string): { titles: string[]; bell: boolean; carry: string } {
  let data = carry + chunk;
  const open = data.lastIndexOf("\x1b]");
  let next = "";
  if (open !== -1 && !/\x07|\x1b\\/.test(data.slice(open))) {
    next = data.slice(open).slice(-512);
    data = data.slice(0, open);
  } else if (data.endsWith("\x1b")) {
    // The chunk may have split an OSC between its ESC and "]".
    next = "\x1b";
    data = data.slice(0, -1);
  }
  const titles: string[] = [];
  const rest = data.replace(/\x1b\](\d*);?([^\x07\x1b]*)(?:\x07|\x1b\\)/g, (_, code: string, body: string) => {
    if (code === "0" || code === "1" || code === "2") titles.push(body);
    return "";
  });
  return { titles, bell: rest.includes("\x07"), carry: next };
}

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

/** A short per-workspace directory for Unix sockets. A worktree path is too
 * long to hold one: a socket path is capped at 104 bytes on macOS, and
 * agent-browser's daemon failed under it with "socket path would be 136
 * bytes" (#40). */
export const socketDir = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join("/tmp", `den-${groupId.slice(0, 8)}`);
};

const EMPTY_NOTEPAD = `# Handover\n\n${HANDOVER_TEMPLATE}`;

// The den editor (the "den:self-edit" workspace) is one job that runs across
// many workspaces, so its handover outlives each one: closing it moves the
// notepad here and the next editor starts from it. Kept out of PROGRESS_DIR,
// which the Manager reads as the live sessions' handovers.
const CARRY_DIR = join(DATA_DIR, "carry");
const carryPath = (ticket: string | null | undefined) =>
  ticket === "den:self-edit" ? join(CARRY_DIR, "self-edit.md") : null;

/** The handover a closed workspace with this ticket left, removed as it's taken. */
function takeCarried(ticket: string | undefined): string | undefined {
  const file = carryPath(ticket);
  if (!file || !existsSync(file)) return undefined;
  const md = readFileSync(file, "utf8");
  rmSync(file, { force: true });
  return md;
}

/** den's copy of a ticket workspace's ticket section (#39). */
const ticketCopyPath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(PROGRESS_DIR, `${groupId}.ticket.md`);
};

// A review pane's diff, guide, and settings file; remove() deletes them.
const REVIEW_DIR = join(DATA_DIR, "review");
export const reviewDiffPath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(REVIEW_DIR, `${groupId}.diff`);
};
const reviewSettingsPath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(REVIEW_DIR, `${groupId}.settings.json`);
};
// Kept out of the notepad so the review's `## <path>` headings and the
// guide's `## <section title>` ones never share a parser.
export const reviewGuidePath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(REVIEW_DIR, `${groupId}.guide.md`);
};

// A review pane's review. The notepad is the handover, which a pane the
// developer has taken on keeps like any workspace.
export const reviewNotesPath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(REVIEW_DIR, `${groupId}.review.md`);
};

const managerSettingsPath = join(MANAGER_DIR, "settings.json");
// Panes ended at clock out, which Start my day brings back fresh.
const clockedOutPath = join(MANAGER_DIR, "clocked-out.json");

function readClockedOut(): string[] {
  try {
    const ids = JSON.parse(readFileSync(clockedOutPath, "utf8")) as unknown;
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeClockedOut(ids: string[]): void {
  mkdirSync(MANAGER_DIR, { recursive: true });
  writeFileSync(clockedOutPath, JSON.stringify(ids));
}

/** What every Claude pane's --settings carries: den's status line, no
 * compaction while the developer is away (it spends tokens with nobody
 * watching; a stale conversation is started fresh from its handover
 * instead), and the hooks den listens to. Look panes get no inbox or crew. */
function paneSettings(
  groupId: string,
  with_: { inbox?: boolean; crew?: boolean } = {},
  base: { permissions: { deny: string[]; allow: string[]; ask?: string[] } } = { permissions: { deny: [], allow: [] } },
) {
  const { inbox = true, crew = true } = with_;
  const p = base.permissions;
  return {
    ...statusLineSettings(groupId),
    theme: paneTheme(),
    idleCompaction: false,
    // Every pane: a public den issue or comment needs the developer's yes,
    // whatever the pane's mode, and den's database (the Linear key, saved
    // scrollback) is never read.
    permissions: {
      ...p,
      deny: [...p.deny, `Read(//${join(DATA_DIR, "den.db").replace(/^\/+/, "")}*)`],
      ask: [...(p.ask ?? []), "Bash(gh issue create:*)", "Bash(gh issue comment:*)", "Bash(gh issue edit:*)"],
    },
    hooks: mergeHooks(turnHooks(groupId), inbox ? inboxHooks(groupId) : {}, crew ? crewHooks(groupId) : {}),
  };
}

// The hash of the system prompt each workspace's conversation started with
// (see DenSession.promptStale).
const PROMPTS_DIR = join(DATA_DIR, "prompts");
type PromptRecord = { sessionId: string; hash: string };

function readPromptRecord(groupId: string): PromptRecord | null {
  if (!isValidGroupId(groupId)) return null;
  try {
    return JSON.parse(readFileSync(join(PROMPTS_DIR, `${groupId}.json`), "utf8")) as PromptRecord;
  } catch {
    return null;
  }
}

function writePromptRecord(groupId: string, rec: PromptRecord): void {
  if (!isValidGroupId(groupId)) return;
  try {
    mkdirSync(PROMPTS_DIR, { recursive: true });
    writeFileSync(join(PROMPTS_DIR, `${groupId}.json`), JSON.stringify(rec));
  } catch (err) {
    logWarn("prompt record", err);
  }
}

// The rail polls every few seconds, so a notepad is re-read only when it changes.
const waitingCache = new Map<string, { mtime: number; items: string[] }>();

/** A workspace notepad's "Waiting on you" items. */
function handoverWaiting(groupId: string): string[] {
  try {
    const file = notepadPath(groupId);
    const mtime = statSync(file).mtimeMs;
    const hit = waitingCache.get(groupId);
    if (hit?.mtime === mtime) return hit.items;
    const items = waitingItems(readFileSync(file, "utf8"));
    waitingCache.set(groupId, { mtime, items });
    return items;
  } catch {
    return [];
  }
}

const riskCache = new Map<string, { mtime: number; risk: GuideRisk | null }>();

/** A review pane's overall risk, from its guide's intro: a section's
 * "- risk: ..." line notes must not count. */
function reviewRisk(groupId: string): GuideRisk | null {
  try {
    const file = reviewGuidePath(groupId);
    const mtime = statSync(file).mtimeMs;
    const hit = riskCache.get(groupId);
    if (hit?.mtime === mtime) return hit.risk;
    const { risk } = guideRisk(readFileSync(file, "utf8").split(/^ {0,3}#{2,6}\s/m)[0]);
    riskCache.set(groupId, { mtime, risk });
    return risk;
  } catch {
    return null;
  }
}

/** Whether a checkout is mid-merge or mid-rebase, or has staged changes. */
function gitWorkState(cwd: string): { merging: boolean; staged: boolean } {
  const git = (...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 5000 }).trim();
  try {
    const gitPath = (p: string) => git("rev-parse", "--git-path", p);
    const abs = (p: string) => (p.startsWith("/") ? p : join(cwd, p));
    const merging = ["MERGE_HEAD", "rebase-merge", "rebase-apply"].some((p) => existsSync(abs(gitPath(p))));
    let staged = false;
    try {
      git("diff", "--cached", "--quiet");
    } catch {
      staged = true;
    }
    return { merging, staged };
  } catch {
    return { merging: false, staged: false }; // not a git checkout
  }
}


/**
 * Which conversation a restarting Claude pane reopens:
 * 1. its pinned session, if that transcript exists -> resume it;
 * 2. a pinned id with no transcript -> start fresh under the same id. Claude
 *    Code writes no transcript until the first message, so this is any pane
 *    restarted before anyone typed in it. Never borrow another conversation:
 *    look panes share the work repo's main checkout, so "newest in this cwd"
 *    is often another ticket's session (#25);
 * 3. no pinned id (an old row) -> the newest conversation in this cwd;
 * 4. else a fresh session under a new id.
 */
export function chooseResume(
  pinnedId: string | null,
  hasTranscript: (id: string) => boolean,
  latestForCwd: () => string | null,
): { resume: boolean; id: string } {
  if (pinnedId) return { resume: hasTranscript(pinnedId), id: pinnedId };
  const latest = latestForCwd();
  if (latest) return { resume: true, id: latest };
  return { resume: false, id: randomUUID() };
}

// One token of terminal input: a bracketed paste (its body captured), an
// escape sequence (X10 mouse report, OSC or DCS reply, CSI with any private
// prefix such as an SGR mouse report "\x1b[<", SS3 key, or Alt plus a key),
// or one character.
const INPUT_TOKENS =
  /\x1b\[200~([\s\S]*?)\x1b\[201~|\x1b(?:\[M[\s\S]{3}|\][^\x07\x1b]*(?:\x07|\x1b\\)|P[\s\S]*?\x1b\\|\[[0-?]*[ -/]*[@-~]|O.|[\s\S])?|[\s\S]/gu;
// Up (history), Ctrl+R (history search), and Ctrl+Y (yank) can fill the prompt without typing.
const FILLS_PROMPT = new Set(["\x1b[A", "\x1bOA", "\x12", "\x19"]);

/** About how many characters the developer's input `data` leaves unsent in
 * the prompt, from `len` before it. Enter and Ctrl+C empty it and backspace
 * takes one off; keys, focus and mouse reports, and terminal replies add
 * nothing. Line-editing keys den can't follow leave it as it is, so it errs
 * toward a draft: den must never submit over one. */
export function draftAfter(len: number, data: string): number {
  for (const m of data.matchAll(INPUT_TOKENS)) {
    const t = m[0];
    if (m[1] !== undefined) len += [...m[1]].length;
    else if (t === "\r" || t === "\x03") len = 0;
    else if (t === "\x7f" || t === "\b") len = Math.max(0, len - 1);
    else if (FILLS_PROMPT.has(t)) len = Math.max(len, 1);
    else if (t >= " ") len += 1;
  }
  return len;
}

/** Why a pane must stay up at clock out (#46), or [] when it's safe to end.
 * The running sessions' own list: never end one mid-work, mid-merge, with
 * something staged, or while CI is running. A question waiting for the
 * developer isn't on it: den can't see one (the bell rings at the end of
 * every turn), and Hedgehog's handover carries it into "Waiting on you". */
/** Where one pane is in Hedgehog's round. "failed": it didn't end. */
export type TuckStage = "handover" | "ending" | "done" | "failed";

export interface ClockOutRound {
  /** "nap": handovers only, the panes keep running (a break, not the day's end). */
  kind: "clockout" | "nap";
  startedAt: number;
  /** Set once every pane is done or given up on: safe to close the laptop. */
  finishedAt: number | null;
  panes: { id: string; name: string; stage: TuckStage; handoverFailed?: boolean; noHandover?: boolean }[];
}

export function clockOutBlockers(p: {
  pinned: boolean;
  busy: boolean;
  /** At a permission prompt or a question: ending it drops what it asked. */
  needsYou?: boolean;
  merging: boolean;
  staged: boolean;
  ciPending: boolean;
}): string[] {
  const out: string[] = [];
  if (p.pinned) out.push("pinned to stay running");
  if (p.busy) out.push("still working");
  if (p.needsYou) out.push("waiting on you (a permission prompt or a question)");
  if (p.merging) out.push("a merge or rebase is in progress");
  if (p.staged) out.push("has staged changes");
  if (p.ciPending) out.push("CI is still running on its PR");
  return out;
}

/** How long a workspace pane sits with no output before den refreshes its
 * handover (#23), unless overridden (see idleHandoverMs). */
export const IDLE_HANDOVER_MS = 30 * 60_000;

/** The idle window in ms; 0 means off. */
function idleHandoverMs(): number {
  for (const raw of [process.env.DEN_IDLE_HANDOVER_MIN, store.getSetting("idle_handover_min")]) {
    if (raw == null || raw === "") continue;
    if (raw.trim().toLowerCase() === "off") return 0;
    const min = Number(raw);
    if (Number.isFinite(min) && min >= 0) return min * 60_000;
  }
  return IDLE_HANDOVER_MS;
}

/** A notepad written this close to the end of a burst of work is taken as
 * current: sessions update it at the end of a step, then print their reply. */
export const NOTEPAD_FRESH_MS = 2 * 60_000;

/** Is an idle handover due? Only after input since the last one (else an
 * untouched pane gets one every idle period), `idleMs` without output, and no
 * notepad write near the end of that output. */
export function idleHandoverDue(p: {
  now: number;
  idleMs: number;
  lastOutputAt: number;
  lastInputAt: number;
  lastHandoverAt: number;
  notepadMtime: number;
}): boolean {
  if (p.idleMs <= 0) return false;
  if (p.lastInputAt <= p.lastHandoverAt) return false;
  if (!p.lastOutputAt || p.now - p.lastOutputAt < p.idleMs) return false;
  return p.notepadMtime < p.lastOutputAt - NOTEPAD_FRESH_MS;
}

/**
 * Does a PTY look ready for scripted input: some output, then `idleMs` of
 * quiet? Claude's TUI drops input that arrives while it's starting up
 * (measured: a paste 6s after spawn vanished, the same paste at 12s landed),
 * so anything den sends on its own waits for this rather than a fixed delay.
 * No output yet means still booting, not idle.
 */
export function ptyLooksIdle(
  lastOutputAt: number,
  now: number,
  idleMs: number,
): boolean {
  if (!lastOutputAt) return false;
  return now - lastOutputAt >= idleMs;
}

/**
 * New `pos` for every session given the rail's workspace order.
 *
 * Groups named in `groupIds` take those slots in that order; any group the
 * client didn't name (e.g. a workspace created between the drag and the request)
 * keeps its relative order after them, ranked by its current `pos`. Panes of one
 * workspace all get the same number — `list()` breaks the tie by `createdAt`.
 */
export function reorderPositions(
  sessions: { id: string; groupId: string; pos: number }[],
  groupIds: string[],
): Map<string, number> {
  const rank = new Map<string, number>();
  groupIds.forEach((g, i) => rank.set(g, i));
  const unlisted = [...new Set(sessions.map((s) => s.groupId))]
    .filter((g) => !rank.has(g))
    .sort(
      (a, b) =>
        Math.min(...sessions.filter((s) => s.groupId === a).map((s) => s.pos)) -
        Math.min(...sessions.filter((s) => s.groupId === b).map((s) => s.pos)),
    );
  unlisted.forEach((g, i) => rank.set(g, groupIds.length + i));
  return new Map(sessions.map((s) => [s.id, rank.get(s.groupId) ?? 0]));
}

/** Metadata shape sent to the web app. */
export interface SessionMeta {
  id: string;
  name: string;
  /** See DenSession.agentName. */
  agentName: string | null;
  /** See DenSession.promptStale. */
  promptStale: boolean;
  /** See DenSession.termTheme. */
  termTheme: PaneTheme | null;
  /** See DenSession.turn. */
  turn: { state: Turn["state"]; message: string | null; detail: string | null } | null;
  color: string;
  cwd: string;
  shell: boolean;
  status: "running" | "exited";
  pid: number | null;
  createdAt: number;
  lastActive: number;
  /** A Claude workspace is one "main" pane plus its "shell" tabs. */
  groupId: string;
  role: "main" | "shell";
  /** Git branch of the working dir (captured at start), and its ticket hint. */
  branch: string | null;
  ticketHint: string | null;
  /** The session rang the bell while unwatched — it wants your attention. */
  attention: boolean;
  /** Linear ticket this workspace is for (identifier, e.g. "ABC-123"). */
  ticket: string | null;
  /** A lightweight "just looking" session: ticket viewer + one Claude pane. */
  look: boolean;
  /** Special GitHub PR layout: "review" (others' PR) or "mypr" (your own). */
  view: "review" | "mypr" | "manager" | null;
  /** The GitHub PR this session is for (number + nameWithOwner repo). */
  pr: number | null;
  prRepo: string | null;
  /** Rail sort key (see `reorder`). The list arrives already sorted by it. */
  pos: number;
  /** Keeps a handover: the notepad instruction and the idle refresh (#11). */
  handover: boolean;
  /** Where the branch stands against its parent and origin (#33). */
  stack: StackStatus | null;
  /** The ticket's description changed since the workspace opened (#38). */
  ticketChanged: boolean;
  /** A review pane the developer has taken on: it may commit, push, and post. */
  owned: boolean;
  /** Clock out leaves this pane running, every night (#46). */
  keepAlive: boolean;
  /** Its handover's "Waiting on you" items, for the rail. */
  waiting: string[];
  /** A review pane's overall risk, from its reading guide. */
  risk: GuideRisk | null;
  /** The crew subagents (agent types) its Claude pane has at work. */
  crewActive: string[];
  /** How full its Claude pane's context window is, as of its last reply. */
  context: PaneContext | null;
}

type Listener = (msg: ServerMessage) => void;

/** Named, because nine positional arguments invite silent transpositions. */
interface SessionInit {
  id: string;
  name: string;
  color: string;
  cwd: string;
  shell: boolean;
  createdAt: number;
  lastActive: number;
  groupId: string;
  role: "main" | "shell";
  /** Rail sort key; defaults to `createdAt` (i.e. creation order). */
  pos?: number;
}

/**
 * One session = one long-lived PTY (Claude Code by default) that outlives any
 * particular WebSocket. It buffers recent output so a (re)attaching client can
 * replay scrollback instantly.
 */
class DenSession {
  term: pty.IPty | null = null;
  /** Where the pane's turn is, from Claude Code's hooks (turnState.ts);
   * null for a pane started without them. */
  turn: Turn | null = null;
  /** The newest turn file den has acted on, so a state den changed itself
   * isn't put back by re-reading the same file. */
  private turnSeenAt = 0;
  private spawnedAt = 0;
  /** Claude Code keeps the system prompt a conversation started with, even
   * on resume, until it is compacted: set when den's instructions for this
   * pane have changed since. */
  promptStale = false;
  /** The theme Claude in this pane started in, which it keeps until it
   * restarts; null for shells. */
  termTheme: PaneTheme | null = null;
  /** The resumed conversation's compactions at spawn, to tell when it next
   * compacts and takes up the current prompt. */
  private compactionsAtSpawn = 0;
  /** The current prompt's hash while the conversation still runs an older one. */
  private pendingHash: string | null = null;
  /** The `-n` name the pane's Claude was last started with, which is how
   * other sessions address it (ListAgents); `name` follows later retitles. */
  agentName: string | null = null;
  status: "running" | "exited" = "running";
  private buffer: string[] = [];
  private bufferBytes = 0;
  /** When the PTY last emitted output; 0 = nothing yet. Drives `waitUntilIdle`
   * and the idle handover. */
  lastOutputAt = 0;
  /** When anything was typed or pasted into the PTY; 0 = never. The idle
   * handover only fires after input since the last one, so a pane nobody has
   * touched doesn't get a handover every half hour. */
  lastInputAt = 0;
  /** When den last ran an idle handover for this pane, and whether one is
   * running now. */
  lastHandoverAt = 0;
  /** When the last handover fork that succeeded started; a fork may leave a
   * current notepad unwritten, so its mtime alone would ask again. */
  handoverSavedAt = 0;
  handoverRunning = false;
  /** The notepad mtime keepTicket last checked. */
  ticketCheckedMtime = 0;
  ticketChanged = false;
  /** Keep a handover (the notepad instruction and the idle refresh). */
  handover = true;
  /** A review pane working on the PR as the developer's own. */
  owned = false;
  keepAlive = false;
  /** New output since the last scrollback flush to the store. */
  private scrollbackDirty = false;
  private listeners = new Set<Listener>();
  private watchers = new Set<(data: string) => void>();
  /** Once the user renames, stop auto-updating the title from the terminal. */
  titleLocked = false;
  private oscCarry = "";
  /** The latest title showed Claude at work (see maybeTitle). */
  private titleBusy = false;
  /** Set when the terminal rings the bell while unwatched (Claude wants input). */
  attention = false;

  /** Claude's args; null means the default (a login shell, or `claude -n <name>`). */
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
  view: "review" | "mypr" | "manager" | null = null;
  pr: number | null = null;
  prRepo: string | null = null;

  id: string;
  name: string;
  color: string;
  cwd: string;
  shell: boolean;
  createdAt: number;
  lastActive: number;
  groupId: string;
  role: "main" | "shell";
  /** Where this session's workspace sits in the rail — see SessionManager.reorder. */
  pos: number;

  constructor(init: SessionInit) {
    this.id = init.id;
    this.name = init.name;
    this.color = init.color;
    this.cwd = init.cwd;
    this.shell = init.shell;
    this.createdAt = init.createdAt;
    this.lastActive = init.lastActive;
    this.groupId = init.groupId;
    this.role = init.role;
    this.pos = init.pos ?? init.createdAt;
  }

  spawn() {
    const loginShell = process.env.SHELL ?? "/bin/zsh";
    const file = this.shell ? loginShell : CLAUDE_BIN;
    const args = this.spawnArgs ?? (this.shell ? [] : ["-n", this.name]);
    const n = args.indexOf("-n");
    this.agentName = this.shell || n < 0 ? null : (args[n + 1] ?? null);
    if (!this.shell) this.notePrompt(args);
    this.termTheme = this.shell ? null : themeFromArgs(args);
    if (!this.shell) clearCrew(this.groupId);
    this.turn = null;
    this.spawnedAt = Date.now();
    this.turnSeenAt = this.spawnedAt;
    // Fox starts each run from a fresh digest; news queued for the last run is stale.
    if (this.view === "manager") removeInbox(this.groupId);
    // The last process's output would make waitUntilIdle pass before this one has drawn.
    this.lastOutputAt = 0;
    let term: pty.IPty;
    try {
      term = pty.spawn(file, args, {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: this.cwd || os.homedir(),
        env: {
          ...process.env,
          TERM: "xterm-256color",
          // xterm.js draws 24-bit colour, so Claude Code can use its theme as designed.
          COLORTERM: "truecolor",
          AGENT_BROWSER_SOCKET_DIR: process.env.AGENT_BROWSER_SOCKET_DIR ?? socketDir(this.groupId),
        },
      });
    } catch (err) {
      // A missing binary or a bad cwd: show the pane as exited rather than
      // failing the create request.
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
      if (!this.shell) clearCrew(this.groupId);
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
    const osc = scanOsc(this.oscCarry, data);
    this.oscCarry = osc.carry;
    if (this.listeners.size === 0 && osc.bell) this.attention = true;
    if (osc.titles.length) this.maybeTitle(osc.titles[osc.titles.length - 1]);
    this.emit({ type: "output", data });
    for (const w of this.watchers) w(data);
  }

  /** Follow this pane's output from den itself. Unlike attach(), it isn't a
   * viewer, so the bell still raises attention. Returns the unsubscribe. */
  /** Record the prompt a new conversation starts with, or, on resume, note
   * whether it differs from the one the conversation kept. */
  private notePrompt(args: string[]) {
    const at = args.indexOf("--append-system-prompt");
    const hash = createHash("sha1").update(at >= 0 ? (args[at + 1] ?? "") : "").digest("hex");
    const fresh = args.indexOf("--session-id");
    const resume = args.indexOf("--resume");
    this.promptStale = false;
    if (fresh >= 0) writePromptRecord(this.groupId, { sessionId: args[fresh + 1], hash });
    else if (resume >= 0) {
      const id = args[resume + 1];
      const rec = readPromptRecord(this.groupId);
      // A conversation from before den kept records is left unflagged.
      this.promptStale = rec?.sessionId === id && rec.hash !== hash;
      this.compactionsAtSpawn = compactions(id);
      if (this.promptStale) this.pendingHash = hash;
    }
  }

  /** Pick up the turn hooks' latest event; a turn that finishes or stops
   * for the developer while nobody watches flags the rail. */
  checkTurn() {
    if (this.shell || this.status !== "running") return;
    const t = readTurn(this.groupId, this.claudeSessionId ?? null);
    if (!t || t.at <= this.turnSeenAt) return;
    this.turnSeenAt = t.at;
    const before = this.turn;
    this.turn = t;
    if (t.state !== "working" && before?.state !== t.state) this.nudge();
  }

  /** Once a stale conversation compacts, it runs on the current prompt. */
  checkCompacted() {
    if (!this.promptStale || !this.claudeSessionId || !this.pendingHash) return;
    if (compactions(this.claudeSessionId) <= this.compactionsAtSpawn) return;
    writePromptRecord(this.groupId, { sessionId: this.claudeSessionId, hash: this.pendingHash });
    this.promptStale = false;
    this.pendingHash = null;
  }

  watch(fn: (data: string) => void): () => void {
    this.watchers.add(fn);
    return () => this.watchers.delete(fn);
  }

  /** Use the latest OSC title as the session name, and flag the end of a
   * turn: Claude Code's title leads with a spinner glyph while it works and
   * with "\u2733" while it waits for input. Claude panes only: shells retitle
   * to the cwd/command on every prompt, which flaps. */
  private maybeTitle(latest: string) {
    if (this.shell) return;
    const waiting = latest.trimStart().startsWith("\u2733");
    // The title glyph is the fallback for a pane started without turn hooks.
    if (waiting && this.titleBusy && this.listeners.size === 0 && !this.turn) this.attention = true;
    this.titleBusy = !waiting;
    if (this.titleLocked) return;
    const title = latest.trim().replace(/\s+/g, " ").slice(0, 60);
    if (title && title !== this.name) {
      this.name = title;
      this.lastActive = Date.now();
      store.update(this.toRow());
      this.emit({ type: "title", name: title });
    }
  }

  lockTitle() {
    this.titleLocked = true;
  }

  /** Flag the session on the rail, as a bell does, unless someone is
   * watching it. */
  nudge() {
    if (this.listeners.size === 0) this.attention = true;
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

  /** About how many characters the developer has typed into the prompt and
   * not sent (see draftAfter). */
  private draftLen = 0;

  /** The developer may have left a draft in the prompt. Den never submits over one. */
  get draft(): boolean {
    return this.draftLen > 0;
  }

  /** Input the developer typed in the terminal (not den's own pastes). */
  typed(data: string) {
    this.draftLen = draftAfter(this.draftLen, data);
    this.write(data);
  }

  write(data: string) {
    this.term?.write(data);
    this.lastActive = Date.now();
    this.lastInputAt = this.lastActive;
    // Escape at a prompt fires no hook, so any input ends "waiting on you";
    // an answered prompt goes on to report working.
    if (this.turn?.state === "needs-you") this.turn = { state: "done", at: this.lastActive, message: null, detail: null };
  }

  /**
   * Wait until the PTY looks ready for scripted input (see `ptyLooksIdle`), so a
   * paste den sends itself isn't swallowed by a TUI that's still drawing. Returns
   * whether it settled; on timeout the caller can still go ahead (a lost paste is
   * no worse than not trying).
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
      agentName: this.agentName,
      promptStale: this.status === "running" && this.promptStale,
      termTheme: this.termTheme,
      turn: this.status === "running" && this.turn ? { state: this.turn.state, message: this.turn.message, detail: this.turn.detail } : null,
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
      ticketHint: parseTicketHint(this.branch) ?? null,
      attention: this.attention,
      ticket: this.ticket,
      look: this.look,
      view: this.view,
      pr: this.pr,
      prRepo: this.prRepo,
      pos: this.pos,
      handover: this.handover,
      owned: this.owned,
      keepAlive: this.keepAlive,
      waiting: worksLikeWorkspace(this) ? handoverWaiting(this.groupId) : [],
      risk: this.view === "review" ? reviewRisk(this.groupId) : null,
      stack: stackStatus(this.id),
      ticketChanged: this.ticketChanged,
      crewActive: this.shell || this.role !== "main" ? [] : activeCrew(this.groupId),
      context: this.shell || this.role !== "main" ? null : readPaneContext(this.groupId, this.claudeSessionId),
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
      pos: this.pos,
      handover: this.handover ? 1 : 0,
      owned: this.owned ? 1 : 0,
      keepAlive: this.keepAlive ? 1 : 0,
    };
  }

  /** Restore persisted scrollback so an attaching client replays it after a
   * server restart (the live PTY is gone, but its output history survives). */
  restoreScrollback(text: string) {
    this.buffer = [text];
    this.bufferBytes = text.length;
  }

  /** Drop the scrollback; a restarted process starts fresh. */
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

// How often to flush changed scrollback to the store. A crash loses at most
// this much recent output; keeping it coarse avoids constant disk writes.
const SCROLLBACK_FLUSH_MS = 5000;

class SessionManager {
  private sessions = new Map<string, DenSession>();
  private colorIdx = 0;
  private round: ClockOutRound | null = null;

  constructor() {
    const timer = setInterval(() => {
      for (const s of this.sessions.values()) {
        s.persistScrollback();
        this.keepTicket(s);
        s.checkCompacted();
        s.checkTurn();
      }
      this.tellManagerWaiting();
    }, SCROLLBACK_FLUSH_MS);
    // Don't keep the process alive just for this (CLI/tests exit cleanly).
    timer.unref?.();
    // Faster than once a minute only when the window is set very short.
    const idleMs = idleHandoverMs();
    if (idleMs > 0) {
      const idleTimer = setInterval(() => this.checkIdleHandovers(), Math.min(60_000, idleMs / 2));
      idleTimer.unref?.();
    }
    watchTurns((groupId) => {
      for (const s of this.sessions.values()) if (s.groupId === groupId) s.checkTurn();
    });
    const mouseTimer = setInterval(() => {
      this.watchTokens();
      this.recordChecks();
    }, 60_000);
    mouseTimer.unref?.();
  }

  /** Alerts already passed to the Manager, so each is said once. */
  private announced = new Set<string>();

  /** Log the helper runs and check results new since the last round, for
   * `groupId` only or for every workspace. */
  recordChecks(groupId?: string): void {
    const sources: CheckSource[] = [];
    for (const s of this.sessions.values()) {
      if (s.shell || s.role !== "main" || (groupId && s.groupId !== groupId)) continue;
      sources.push({
        groupId: s.groupId,
        session: s.agentName ?? s.name,
        repo: s.prRepo,
        branch: s.branch,
        ticket: s.ticket ?? parseTicketHint(s.branch) ?? null,
        pr: s.pr ? `${s.prRepo ?? ""}#${s.pr}` : null,
        review: s.view === "review",
      });
    }
    recordChecks(sources);
  }

  /** The field mouse's round: note the plan's limits, see who is spending,
   * and tell a running Manager about anything new. */
  watchTokens(now = Date.now()): Watch {
    try {
      const readings = noteReading(readLimits(), now);
      const panes = [...this.sessions.values()].flatMap((s) =>
        !s.shell && s.status === "running" && s.claudeSessionId ? [{ id: s.id, name: s.agentName ?? s.name, sessionId: s.claudeSessionId }] : [],
      );
      const watch = assess(readings, now, burners(panes, now - RECENT_MS).slice(0, 5));
      setWatch(watch);
      // An alert that clears and comes back is news again.
      const keys = new Set(watch.alerts.map((a) => a.key));
      for (const k of this.announced) if (!keys.has(k)) this.announced.delete(k);
      const fresh = watch.alerts.filter((a) => !this.announced.has(a.key));
      const manager = this.manager();
      // Held until Fox runs, so one started later still hears what stands.
      if (fresh.length && manager?.status === "running") {
        const who = watch.burners.length
          ? ` Spending the most in the last 30 minutes: ${watch.burners.map((b) => `"${b.name}" ${b.share}%`).join(", ")}.`
          : "";
        tellPane(manager.groupId, `den's field mouse: ${fresh.map((a) => a.message).join(" ")}${who}`);
        for (const a of fresh) this.announced.add(a.key);
      }
      return watch;
    } catch (err) {
      logWarn("field mouse", err);
      return currentWatch();
    }
  }

  /** Whether any headless handover fork is still writing. */
  handoversRunning(): boolean {
    return [...this.sessions.values()].some((s) => s.handoverRunning);
  }

  /** The handover's length when it is past HANDOVER_LONG_CHARS, else null. */
  handoverTooLong(groupId: string): number | null {
    try {
      const notepad = readFileSync(notepadPath(groupId), "utf8");
      let ticket = "";
      try {
        ticket = readFileSync(ticketCopyPath(groupId), "utf8");
      } catch {
        // not a ticket workspace
      }
      const n = handoverLength(notepad, ticket);
      return n > HANDOVER_LONG_CHARS ? n : null;
    } catch {
      return null;
    }
  }

  /** Each session's "Waiting on you" as last seen, to tell the Manager what moved. */
  private waitingSeen = new Map<string, string[]>();

  /** Tell a running Manager when a session's "Waiting on you" changes: the
   * developer often answers in the session itself, which left Today listing
   * settled items. Not a nudge: Fox reads it on its next prompt or tool call. */
  private tellManagerWaiting() {
    // Hedgehog's forks rewrite handovers just before Fox is stopped, so
    // anything queued then would greet tomorrow's Start my day stale.
    if (this.round && !this.round.finishedAt) return;
    const manager = this.manager();
    const live = new Set<string>();
    for (const s of this.sessions.values()) {
      if (!worksLikeWorkspace(s) || !s.handover) continue;
      live.add(s.groupId);
      const now = handoverWaiting(s.groupId);
      const before = this.waitingSeen.get(s.groupId);
      this.waitingSeen.set(s.groupId, now);
      if (!before || manager?.status !== "running") continue;
      const msg = waitingChangeMessage(s.agentName ?? s.name, before, now);
      if (msg) tellPane(manager.groupId, msg);
    }
    for (const id of this.waitingSeen.keys()) if (!live.has(id)) this.waitingSeen.delete(id);
  }

  /** Start an idle handover for every workspace main pane that is due one. */
  private checkIdleHandovers() {
    // A fork reads the whole conversation; with tokens tight it waits for
    // clock out, a nap, or a fresh start, which still write the handover.
    if (currentWatch().level === "tight") return;
    const idleMs = idleHandoverMs();
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (!worksLikeWorkspace(s)) continue;
      if (s.status !== "running" || !s.handover || s.handoverRunning || !s.claudeSessionId) continue;
      let notepadMtime = 0;
      try {
        notepadMtime = statSync(notepadPath(s.groupId)).mtimeMs;
      } catch {
        // no notepad yet: nothing is current, so a handover is worth writing
      }
      const due = idleHandoverDue({
        now, idleMs, notepadMtime,
        lastOutputAt: s.lastOutputAt, lastInputAt: s.lastInputAt, lastHandoverAt: s.lastHandoverAt,
      });
      if (due) void this.runIdleHandover(s);
    }
  }

  /**
   * Refresh a pane's handover from a headless fork of its conversation:
   * `claude -p --resume <id> --fork-session --no-session-persistence` reads the
   * whole conversation, writes the notepad, and exits without saving the fork,
   * so the live pane, its transcript, and the resume list are all untouched.
   * It may only read and edit the notepad. A failure is logged, the pane is
   * left as it was, and the promise resolves false.
   */
  private runIdleHandover(s: DenSession, reason: "quiet" | "fresh" = "quiet"): Promise<boolean> {
    const id = s.claudeSessionId;
    if (!id || !hasSession(id)) return Promise.resolve(true); // nothing said in the pane yet
    // The fork may only Edit, and a my-PR pane opened before it kept a handover has no notepad.
    const notepad = this.ensureNotepad(s.groupId);
    s.handoverRunning = true;
    const startedAt = Date.now();
    s.lastHandoverAt = startedAt;
    return new Promise((resolve) => execFile(
      "claude",
      [
        "-p",
        "--resume", id,
        "--fork-session",
        "--no-session-persistence",
        "--add-dir", PROGRESS_DIR,
        "--allowedTools", "Read", `Edit(//${notepad.replace(/^\/+/, "")})`,
        "--append-system-prompt", progressInstruction(notepad),
        "--", idleHandoverPrompt(notepad, reason, this.handoverTooLong(s.groupId)),
      ],
      { cwd: s.cwd, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err) => {
        s.handoverRunning = false;
        if (err) logWarn("idleHandover", err);
        else s.handoverSavedAt = startedAt;
        resolve(!err);
      },
    ));
  }

  // --- Clock out (#46) ---

  /** Every running Claude pane, with why each must stay up tonight, if it
   * must, and whether it keeps a handover to start fresh from.
   * `pendingBranches`: branches whose PR's CI is still running. */
  clockOutVerdicts(
    pendingBranches: Set<string>,
  ): { id: string; name: string; handover: boolean; reasons: string[] }[] {
    const now = Date.now();
    return [...this.sessions.values()]
      .filter((s) => s.role === "main" && !s.shell && s.status === "running")
      .map((s) => {
        const git = gitWorkState(s.cwd);
        return {
          id: s.id,
          name: s.name,
          handover: canStartFresh(s),
          reasons: clockOutBlockers({
            pinned: s.keepAlive,
            // With turn hooks, "working" is exact; the output check still
            // catches a turn interrupted without a Stop.
            busy: s.turn
              ? s.turn.state === "working" && !ptyLooksIdle(s.lastOutputAt, now, 120_000)
              : !ptyLooksIdle(s.lastOutputAt, now, 20_000),
            needsYou: s.turn?.state === "needs-you",
            merging: git.merging,
            staged: git.staged,
            ciPending: !!s.branch && pendingBranches.has(s.branch) && s.view !== "manager",
          }),
        };
      });
  }

  /** Hedgehog's round: refresh each pane's handover from a fork of its
   * conversation (skipped when the notepad is already newer than its last
   * output, or the pane keeps no handover), end the pane, and remember it, so
   * Start my day brings it back: fresh from its handover, or on its own chat
   * when it has none. Its progress is
   * `clockOutRound()`, which the developer watches to know when it's safe to
   * close the laptop. "busy": a round is already running; "empty": none of
   * the ids is a running pane. */
  clockOut(ids: string[]): ClockOutRound | "busy" | "empty" {
    return this.hedgehogRound("clockout", ids);
  }

  /** A nap: Hedgehog's round without ending anything, for a break in the day.
   * Every running Claude pane; those without a handover are listed as such. */
  nap(): ClockOutRound | "busy" | "empty" {
    const ids = [...this.sessions.values()]
      .filter((s) => s.role === "main" && !s.shell && s.status === "running")
      .map((s) => s.id);
    return this.hedgehogRound("nap", ids);
  }

  private hedgehogRound(kind: ClockOutRound["kind"], ids: string[]): ClockOutRound | "busy" | "empty" {
    if (this.round && !this.round.finishedAt) return "busy";
    const panes = ids.flatMap((id) => {
      const s = this.sessions.get(id);
      const noHandover = !!s && !canStartFresh(s);
      const entry: ClockOutRound["panes"][number] = {
        id,
        name: s?.name ?? "",
        stage: kind === "nap" ? (noHandover ? "done" : "handover") : "ending",
        ...(noHandover ? { noHandover } : {}),
      };
      return s && s.status === "running" ? [{ s, entry }] : [];
    });
    if (panes.length === 0) return "empty";
    const round: ClockOutRound = { kind, startedAt: Date.now(), finishedAt: null, panes: panes.map((p) => p.entry) };
    this.round = round;
    const list = kind === "clockout" ? new Set(readClockedOut()) : null;
    void Promise.all(
      panes.map(async ({ s, entry }) => {
        try {
          // A review's or ticket look's notepad is its review or ticket, not a handover.
          if (!entry.noHandover && !s.handoverRunning && this.handoverBehind(s)) {
            entry.stage = "handover";
            if (!(await this.runIdleHandover(s))) entry.handoverFailed = true;
          }
          if (!list) {
            entry.stage = "done";
            return;
          }
          entry.stage = "ending";
          if (await this.stopPane(s)) {
            list.add(s.id);
            entry.stage = "done";
          } else entry.stage = "failed";
        } catch (err) {
          logWarn("clockOut", err);
          entry.stage = "failed";
        }
      }),
    ).finally(() => {
      if (list) writeClockedOut([...list]);
      round.finishedAt = Date.now();
    });
    return round;
  }

  /** Has the pane's conversation moved on since its notepad was last written?
   * The transcript's mtime covers an exited pane, whose output time is gone
   * after a den restart. */
  private handoverBehind(s: DenSession): boolean {
    let notepadMtime = 0;
    try {
      notepadMtime = statSync(notepadPath(s.groupId)).mtimeMs;
    } catch {
      // no notepad yet
    }
    const lastActivity = Math.max(s.lastOutputAt, s.claudeSessionId ? sessionMtime(s.claudeSessionId) : 0);
    return Math.max(notepadMtime, s.handoverSavedAt) < lastActivity - NOTEPAD_FRESH_MS;
  }

  /** The latest clock out or nap round, running or finished; null before the first. */
  clockOutRound(): ClockOutRound | null {
    return this.round;
  }

  /** Start my day: bring back last night's clocked-out panes, on fresh
   * conversations picking up from their handovers where they keep one, and
   * drop the finished round, whose clean clock out keeps the status fox asleep.
   * Returns the names of the panes started fresh, which wait for Fox's brief. */
  async wakeClockedOut(): Promise<string[]> {
    if (this.round?.finishedAt) this.round = null;
    const fresh: string[] = [];
    for (const id of readClockedOut()) {
      const s = this.sessions.get(id);
      if (!s || s.status !== "exited" || s.view === "manager") continue;
      if (!canStartFresh(s)) this.restart(id);
      else {
        const meta = await this.restartFresh(id);
        if (meta && meta !== "handover_failed" && meta.status === "running") fresh.push(s.name);
      }
    }
    writeClockedOut([]);
    return fresh;
  }

  /** Restore persisted rows as exited placeholders (live PTYs don't survive). */
  hydrate() {
    store.markAllExited();
    this.adopt(store.all());
  }

  /** Load stored rows as exited panes, skipping any already loaded: at boot,
   * and for sessions imported from Den. */
  adopt(rows: SessionRow[]) {
    for (const row of rows) {
      if (this.sessions.has(row.id)) continue;
      const s = new DenSession({
        id: row.id,
        name: row.name,
        color: row.color,
        cwd: row.cwd,
        shell: row.shell === 1,
        createdAt: row.createdAt,
        lastActive: row.lastActive,
        groupId: row.groupId ?? row.id,
        role: (row.role as "main" | "shell") ?? "main",
        pos: row.pos ?? row.createdAt,
      });
      s.status = "exited";
      s.claudeSessionId = row.claudeSessionId ?? null;
      s.branch = row.branch ?? null;
      s.ticket = row.ticket ?? null;
      s.look = row.look === 1;
      s.view = (row.view as "review" | "mypr" | "manager" | null) ?? null;
      s.pr = row.pr ?? null;
      s.prRepo = row.prRepo ?? null;
      s.titleLocked = row.titleLocked === 1;
      s.handover = row.handover !== 0;
      s.owned = row.owned === 1;
      s.keepAlive = row.keepAlive === 1;
      if (row.scrollback) s.restoreScrollback(row.scrollback);
      this.sessions.set(s.id, s);
      // At boot, so an old review shows before its pane is restarted.
      if (s.view === "review" && s.role === "main") {
        try {
          this.ensureReviewNotes(s.groupId);
        } catch (err) {
          logWarn("review notes", err);
        }
      }
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
    /** The ticket section of `notepadSeed`, which den puts back if a rewrite
     * drops it. */
    notepadTicket?: string;
    view?: "review" | "mypr" | "manager";
    pr?: number;
    prRepo?: string;
    initialPrompt?: string;
    /** The PR's unified diff, for a review pane's read-only diff file. */
    reviewDiff?: string;
    /** A review pane that works on the PR as the developer's own. */
    owned?: boolean;
  }) {
    const now = Date.now();
    const shell = opts.shell ?? false;
    const color = opts.color ?? COLORS[this.colorIdx++ % COLORS.length];
    const cwd = this.resolveCwd(opts.cwd);
    const groupId = randomUUID();
    const branch = gitBranch(cwd);

    if (shell) {
      const name = opts.name ?? "shell";
      const s = new DenSession({
        id: groupId, name, color, cwd, shell: true,
        createdAt: now, lastActive: now, groupId, role: "main",
      });
      s.branch = branch;
      this.spawnSession(s);
      return s.meta();
    }

    // Single-pane Claude sessions: a ticket look, a PR review, or a my-PR view.
    if (opts.look || opts.view) {
      const name =
        opts.name ?? opts.ticket ?? (opts.pr ? `PR #${opts.pr}` : "look");
      const s = new DenSession({
        id: groupId, name, color, cwd, shell: false,
        createdAt: now, lastActive: now, groupId, role: "main",
      });
      s.claudeSessionId = randomUUID();
      s.branch = branch;
      s.ticket = opts.ticket ?? null;
      s.look = !!opts.look;
      s.view = opts.view ?? null;
      s.pr = opts.pr ?? null;
      s.prRepo = opts.prRepo ?? null;
      s.owned = s.view === "review" && !!opts.owned;
      s.spawnArgs = [
        "--session-id", s.claudeSessionId, "-n", name,
        ...this.singlePaneArgs(s, { diff: opts.reviewDiff, seed: opts.notepadSeed }),
      ];
      // Keep the ticket/PR title rather than Claude's.
      if (opts.ticket || opts.pr || s.view === "manager") s.titleLocked = true;
      this.spawnSession(s);
      return s.meta();
    }

    const name = opts.name ?? `den-${this.sessions.size + 1}`;
    this.ensureNotepad(groupId, opts.notepadSeed ?? takeCarried(opts.ticket));
    if (opts.notepadTicket) writeFileSync(ticketCopyPath(groupId), opts.notepadTicket);

    const main = new DenSession({
      id: randomUUID(), name, color, cwd, shell: false,
      createdAt: now, lastActive: now, groupId, role: "main",
    });
    // Pin the conversation id (or adopt the one we're resuming) so a later
    // restart can bring back THIS exact conversation.
    main.claudeSessionId = opts.resumeId ?? randomUUID();
    main.spawnArgs = [
      ...(opts.resumeId
        ? ["--resume", opts.resumeId]
        : ["--session-id", main.claudeSessionId, "-n", name]),
      ...this.workspaceArgs(groupId, cwd, true, opts.ticket),
      // `--` so a prompt starting with "-" is read as the prompt, never a flag.
      ...(opts.initialPrompt && !opts.resumeId ? ["--", opts.initialPrompt] : []),
    ];
    main.branch = branch;
    main.ticket = opts.ticket ?? null;
    // Keep the ticket title rather than Claude's.
    if (opts.ticket) main.titleLocked = true;
    this.spawnSession(main);

    const term = new DenSession({
      id: randomUUID(), name: "terminal", color, cwd, shell: true,
      createdAt: now, lastActive: now, groupId, role: "shell",
    });
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
    const term = new DenSession({
      id: randomUUID(), name: "terminal", color: sibling.color,
      cwd: sibling.cwd, shell: true, createdAt: now, lastActive: now,
      groupId, role: "shell",
    });
    term.branch = sibling.branch;
    this.spawnSession(term);
    return term.meta();
  }

  /** Re-spawn an exited session's PTY in place, keeping its identity and
   * context. Args are rebuilt rather than reused, so a restart never re-sends
   * a one-time initial prompt. Null if unknown or already running. */
  restart(id: string): SessionMeta | null {
    const s = this.sessions.get(id);
    if (!s || s.status === "running") return null;
    s.spawnArgs = s.shell ? null : this.restartArgs(s);
    // A restarted pane reads its ticket from the notepad.
    this.keepTicket(s);
    s.clearBuffer();
    s.spawn();
    store.update(s.toRow());
    return s.meta();
  }

  /** Claude spawn args for a restart, rebuilt from the session's context by
   * the same builders create() uses, so a revived pane gets exactly the system
   * prompt a fresh one would. */
  private restartArgs(s: DenSession): string[] {
    const resume = this.resumeArgs(s);
    if (s.role === "main" && !s.look && !s.view) {
      return [...resume, ...this.workspaceArgs(s.groupId, s.cwd, s.handover, s.ticket)];
    }
    return [...resume, ...this.singlePaneArgs(s)];
  }

  /** The notepad wiring and system prompt for a workspace main pane, shared by
   * create() and restartArgs(). The notepad itself is created (and seeded) by
   * create(); a restart keeps whatever is in it. */
  private workspaceArgs(groupId: string, cwd: string, handover = true, ticket?: string | null): string[] {
    mkdirSync(PROGRESS_DIR, { recursive: true });
    // With the handover off, the pane still gets the house rules, just not
    // the notepad instruction (the notepad stays for the developer's own use).
    const base = handover
      ? workspaceInstruction(notepadPath(groupId))
      : `${houseRules()}\n${testingRules()}\n${commentRules()}\n${denWatchRule()}\n${crewRule("in your reply")}\n${ticketDiscussionRule()}\n${denIssueRule()}`;
    const hint = setupHint(cwd);
    const prompt = hint ? `${base}\n${hint}` : base;
    return [
      "--settings", JSON.stringify(paneSettings(groupId)),
      "--add-dir", PROGRESS_DIR,
      "--add-dir", ensureChecksDir(),
      "--agents", JSON.stringify(kitAgents(fableHasRoom())),
      // Beaver, the clean-up workspace: its audit is mechanical, and the
      // developer approving its plan is the safety step, so Opus isn't needed.
      ...(ticket === "den:cleanup" ? ["--model", "sonnet"] : []),
      "--append-system-prompt", prompt,
    ];
  }

  /** The system prompt (and any files it names) for a single-pane Claude
   * session, shared by create() and restartArgs(). `diff` and `seed` come only
   * from create; a restart keeps what was saved before. */
  private singlePaneArgs(
    s: DenSession,
    from: { diff?: string; seed?: string } = {},
  ): string[] {
    // A review pane's settings file carries the status line too.
    if (s.view === "review") return this.reviewArgs(s, from.diff);
    if (s.view === "manager") return this.managerArgs(s);
    const settings = ["--settings", JSON.stringify(paneSettings(s.groupId, { inbox: false, crew: false }))];
    if (s.view === "mypr") {
      // Like a workspace, the notepad stays for the developer when the handover is off.
      const notepad = this.ensureNotepad(s.groupId);
      const prompt = myPrInstruction(s.pr, s.prRepo, s.branch, s.handover ? notepad : "");
      const hint = setupHint(s.cwd);
      return [
        "--settings", JSON.stringify(paneSettings(s.groupId)),
        "--add-dir", PROGRESS_DIR,
        "--add-dir", ensureChecksDir(),
        "--agents", JSON.stringify(kitAgents(fableHasRoom())),
        "--append-system-prompt", hint ? `${prompt}\n${hint}` : prompt,
      ];
    }
    if (s.look) {
      // A look pane from before den saved the ticket has no seed: say so in the
      // file rather than leave the session hunting for a description.
      const fallback =
        `# ${s.ticket ?? s.name}\n\nden did not save this ticket's description. ` +
        `Ask the developer to paste it.\n`;
      const file = this.ensureNotepad(s.groupId, from.seed ?? fallback);
      return [
        ...settings,
        "--add-dir", PROGRESS_DIR,
        "--append-system-prompt", lookInstruction(s.ticket, s.name, file),
      ];
    }
    return settings;
  }

  /** A review pane's settings file, files, and system prompt. Pass `diff` on
   * create; a restart omits it and keeps the captured diff. `--permission-mode
   * default` keeps the settings file's deny rules in force. */
  private reviewArgs(s: DenSession, diff?: string): string[] {
    const reviewFile = this.ensureReviewNotes(s.groupId);
    const handover = s.owned ? this.ensureNotepad(s.groupId) : "";
    const diffFile = this.ensureReviewDiff(s.groupId, diff);
    const guideFile = this.ensureReviewGuide(s.groupId);
    const settingsFile = this.ensureReviewPerms(s.groupId, s.owned);
    const prompt = reviewInstruction(reviewFile, diffFile, s.branch, guideFile, s.owned, handover);
    const hint = s.owned ? setupHint(s.cwd) : "";
    return [
      "--settings", settingsFile,
      // Taken on, it runs in the developer's own mode like a workspace; the
      // deny backstop it would enforce is empty then anyway.
      ...(s.owned ? [] : ["--permission-mode", "default"]),
      "--add-dir", PROGRESS_DIR,
      "--add-dir", REVIEW_DIR,
      "--add-dir", ensureChecksDir(),
      "--agents", JSON.stringify(s.owned ? kitAgents(fableHasRoom()) : reviewAgents()),
      "--append-system-prompt", hint ? `${prompt}\n${hint}` : prompt,
    ];
  }

  /** The Manager pane's settings file, directories, and system prompt. It
   * runs on Opus whatever the developer's default is: the triage is the
   * judgment the workers feed. */
  private managerArgs(s: DenSession): string[] {
    const notepad = this.ensureNotepad(s.groupId);
    mkdirSync(MANAGER_DIR, { recursive: true });
    writeFileSync(
      managerSettingsPath,
      JSON.stringify(
        {
          ...paneSettings(s.groupId, {}, buildManagerPermissions(TODAY_PATH, notepad)),
        },
        null,
        2,
      ),
    );
    return [
      "--model", "opus",
      "--settings", managerSettingsPath,
      "--add-dir", PROGRESS_DIR,
      "--add-dir", MANAGER_DIR,
      "--agents", JSON.stringify(managerAgents(fableHasRoom(), DIGEST_PATH)),
      "--append-system-prompt", managerInstruction(notepad, TODAY_PATH, DIGEST_PATH),
    ];
  }

  /** The Manager pane, if there is one. */
  manager(): DenSession | undefined {
    return [...this.sessions.values()].find((s) => s.view === "manager" && s.role === "main");
  }

  /** The Manager pane, ready for the day's start prompt: created if there is
   * none, started fresh from its handover if it has exited, left alone if it
   * is running. */
  async startManager(): Promise<DenSession | undefined> {
    const m = this.manager();
    if (!m) {
      // The work repo, not MANAGER_DIR: Claude Code already trusts it, where a
      // new folder opens on a trust prompt that the start prompt's Enter would
      // answer; and `gh pr view <n>` needs a repo to run in.
      const meta = this.create({ name: MANAGER_NAME, view: "manager", cwd: workDir() });
      return this.sessions.get(meta.id);
    }
    if (m.status === "exited") await this.restartFresh(m.id);
    return m;
  }

  /** Every other Claude pane on the rail, with the developer's part of its
   * handover, for the Manager's digest. */
  digestSessions(seen: Set<string> | null = null): DigestSession[] {
    return [...this.sessions.values()]
      .filter((s) => s.role === "main" && !s.shell && s.view !== "manager")
      .sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt)
      .map((s) => {
        let handover: DigestSession["handover"] = null;
        // A look pane's notepad is its ticket, and a review pane's is left over from being taken on.
        if (worksLikeWorkspace(s)) {
          try {
            const file = notepadPath(s.groupId);
            handover = { top: developerSections(readFileSync(file, "utf8")), writtenAt: statSync(file).mtimeMs };
          } catch {
            // no notepad yet, or unreadable
          }
        }
        const m = s.meta();
        // An exited pane comes back under its current name.
        const name = (s.status === "running" && s.agentName) || s.name;
        return {
          groupId: s.groupId, name, title: name === s.name ? null : s.name,
          handoverPath: worksLikeWorkspace(s) && s.handover ? notepadPath(s.groupId) : null,
          isNew: !!seen && !seen.has(s.groupId),
          status: s.status, ticket: s.ticket, branch: s.branch, pr: s.pr,
          attention: m.attention, stack: m.stack, handover,
        };
      });
  }

  /** The `claude` args that reopen (or restart) a pane's conversation; see
   * chooseResume for the rules. Adopts whatever id it settles on, so the next
   * restart of this pane is unambiguous. */
  private resumeArgs(s: DenSession): string[] {
    const pick = chooseResume(s.claudeSessionId, hasSession, () => latestSessionForCwd(s.cwd));
    s.claudeSessionId = pick.id;
    return pick.resume
      ? ["--resume", pick.id]
      : ["--session-id", pick.id, "-n", s.name];
  }

  /** Switch a review pane between reviewing the PR and working on it as the
   * developer's own. Its rules live in the system prompt and settings file,
   * so a running pane is restarted into the same conversation to pick them up.
   * Null if it isn't a review pane. */
  async setOwned(id: string, on: boolean): Promise<SessionMeta | null> {
    const s = this.sessions.get(id);
    if (!s || s.view !== "review") return null;
    s.owned = on;
    store.update(s.toRow());
    if (!(await this.stopPane(s))) return s.meta();
    return this.restart(id);
  }

  /** End a workspace pane's conversation and start a new one that picks up
   * from its handover (#43), so a chat that has run for days stops reloading
   * its whole context. The old conversation stays in the Resume list. Null if
   * the pane has no handover to pick up from.
   * `saveHandover`: first have a fork of the conversation bring a handover
   * that's behind up to date, and leave the pane as it is if that fails
   * ("handover_failed"), since the new conversation knows only the handover. */
  async restartFresh(
    id: string,
    opts: { saveHandover?: boolean } = {},
  ): Promise<SessionMeta | null | "handover_failed"> {
    const s = this.sessions.get(id);
    if (!s || !canStartFresh(s)) return null;
    if (opts.saveHandover) {
      while (s.handoverRunning) await new Promise((r) => setTimeout(r, 500));
      if (this.handoverBehind(s) && !(await this.runIdleHandover(s, "fresh"))) return "handover_failed";
    }
    if (!(await this.stopPane(s))) return s.meta();
    // A pinned id with no transcript starts a new conversation (chooseResume).
    s.claudeSessionId = randomUUID();
    return this.restart(id);
  }

  /** Why freshBriefRoute has no route, for the developer. */
  freshBriefBlocker(): string {
    const m = this.manager();
    if (!m || m.status !== "running") return "Fox isn't running.";
    if (m.draft) return "Fox's prompt may hold text you haven't sent: send it, or press Ctrl+C in Fox to clear it, then start again.";
    if (m.turn?.state === "needs-you") return "Fox is waiting on you: answer it, then start again.";
    return "Fox hasn't had a message yet: say hello to Fox, then start again.";
  }

  /** How a pane the developer just started fresh gets its first message:
   * from Fox, typed into an idle Fox ("paste") or left in its inbox while it
   * works ("inbox"), else (no Fox, or Fox waiting on the developer or with a
   * draft in its prompt) null, and den sends the pane its fresh-start prompt. */
  freshBriefRoute(): { via: "paste" | "inbox"; manager: DenSession } | null {
    const m = this.manager();
    if (!m || m.status !== "running" || m.draft) return null;
    if (m.turn?.state === "done") return { via: "paste", manager: m };
    if (m.turn?.state === "working") return { via: "inbox", manager: m };
    return null;
  }

  /** Kill a running pane and wait for it to exit; false if it didn't. */
  private async stopPane(s: DenSession): Promise<boolean> {
    if (s.status !== "running") return true;
    s.kill();
    const deadline = Date.now() + 5000;
    while (s.status === "running" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return s.status !== "running";
  }

  /** Turn a workspace's handover on or off. The idle refresh follows at once;
   * the notepad instruction is part of the system prompt, so it follows from
   * the pane's next start. */
  setHandover(id: string, on: boolean): SessionMeta | null {
    const s = this.sessions.get(id);
    if (!s || !worksLikeWorkspace(s)) return null;
    s.handover = on;
    store.update(s.toRow());
    return s.meta();
  }

  /** Pin a pane so Clock out leaves it running (#46). */
  setKeepAlive(id: string, on: boolean): SessionMeta | null {
    const s = this.sessions.get(id);
    if (!s || s.shell || s.role !== "main") return null;
    s.keepAlive = on;
    store.update(s.toRow());
    return s.meta();
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  /** The plan's limits, and the running Claude panes by how much context each
   * turn sends, largest first (#45). */
  usageOverview(): { limits: PlanLimits | null; panes: { id: string; name: string; context: number }[]; watch: Watch } {
    const panes = [...this.sessions.values()]
      .flatMap((s) =>
        !s.shell && s.status === "running" && s.claudeSessionId
          ? [{ id: s.id, name: s.name, context: contextSize(s.claudeSessionId) }]
          : [],
      )
      .filter((p) => p.context > 0)
      .sort((a, b) => b.context - a.context);
    return { limits: readLimits(), panes, watch: currentWatch() };
  }

  list(): SessionMeta[] {
    // Sorted here (not just in the store) so a session created since the last
    // hydrate lands in the right place without a round-trip through sqlite.
    return [...this.sessions.values()]
      .sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt)
      .map((s) => s.meta());
  }

  /**
   * Reorder the rail: `groupIds` is the workspace order the user dragged into
   * place. Every pane of a workspace shares its workspace's position, so shell
   * tabs travel with their main pane and keep their own creation order within it.
   */
  reorder(groupIds: string[]): SessionMeta[] {
    const positions = reorderPositions([...this.sessions.values()], groupIds);
    for (const s of this.sessions.values()) {
      const pos = positions.get(s.id);
      if (pos === undefined || pos === s.pos) continue;
      s.pos = pos;
      store.update(s.toRow());
    }
    return this.list();
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
    // Its runs log and check result go with it.
    this.recordChecks(groupId);
    let carry: string | null = null;
    for (const other of [...this.sessions.values()]) {
      if (other.groupId === groupId) {
        if (other.role === "main") carry = carryPath(other.ticket);
        other.kill();
        this.sessions.delete(other.id);
        store.delete(other.id);
      }
    }
    // Closing the workspace deletes its files; exit and restart keep them.
    try {
      const notepad = notepadPath(groupId);
      // An untouched notepad isn't carried, so it can't replace a real handover.
      if (carry && existsSync(notepad) && readFileSync(notepad, "utf8") !== EMPTY_NOTEPAD) {
        mkdirSync(CARRY_DIR, { recursive: true });
        renameSync(notepad, carry);
      }
      rmSync(notepad, { force: true });
      rmSync(ticketCopyPath(groupId), { force: true });
      rmSync(join(PROMPTS_DIR, `${groupId}.json`), { force: true });
      removeTurn(groupId);
      rmSync(checkResultPath(groupId), { force: true });
      removeCrewRuns(groupId);
      rmSync(join(REVIEW_DIR, `${groupId}.lines.json`), { force: true });
      rmSync(socketDir(groupId), { recursive: true, force: true });
      rmSync(reviewDiffPath(groupId), { force: true });
      rmSync(reviewDiffPath(groupId).replace(/\.diff$/, ".head"), { force: true });
      rmSync(reviewSettingsPath(groupId), { force: true });
      rmSync(reviewGuidePath(groupId), { force: true });
      rmSync(reviewNotesPath(groupId), { force: true });
      if (isValidGroupId(groupId)) {
        removeLimits(groupId);
        removeInbox(groupId);
        clearCrew(groupId);
      }
    } catch {
      // invalid id / already gone — nothing to clean up
    }
    return true;
  }

  // --- PR-review guardrails ---

  /** The diff a review pane's guide and review were written against. */
  readReviewDiff(groupId: string): string {
    try {
      return readFileSync(reviewDiffPath(groupId), "utf8");
    } catch {
      return "";
    }
  }

  /** Replace it, when the developer asks for the review to catch up with new commits. */
  writeReviewDiff(groupId: string, diff: string): void {
    this.ensureReviewDiff(groupId, diff);
  }

  /** The PR head commit the saved diff was taken at; empty if not recorded. */
  readReviewHead(groupId: string): string {
    try {
      return readFileSync(reviewDiffPath(groupId).replace(/\.diff$/, ".head"), "utf8").trim();
    } catch {
      return "";
    }
  }

  writeReviewHead(groupId: string, sha: string): void {
    mkdirSync(REVIEW_DIR, { recursive: true });
    writeFileSync(reviewDiffPath(groupId).replace(/\.diff$/, ".head"), sha);
  }

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

  /** Make sure the review pane's guide file exists (empty), so the Guide tab has
   * something to poll and Claude's `Edit` allow rule has a target from the
   * start. Kept across restart like the notepad. Returns the file path. */
  private ensureReviewGuide(groupId: string): string {
    mkdirSync(REVIEW_DIR, { recursive: true });
    const file = reviewGuidePath(groupId);
    if (!existsSync(file)) writeFileSync(file, "");
    return file;
  }

  /** A review pane's review file. Review panes from before it existed wrote
   * the review to the notepad, so the first start moves it over; the file
   * then exists, even empty, and the notepad is left for a handover. */
  private ensureReviewNotes(groupId: string): string {
    mkdirSync(REVIEW_DIR, { recursive: true });
    const file = reviewNotesPath(groupId);
    if (existsSync(file)) return file;
    const old = notepadPath(groupId);
    if (existsSync(old)) renameSync(old, file);
    else writeFileSync(file, "");
    return file;
  }

  /** The review as the review session has written it so far. */
  readReviewNotes(groupId: string): string {
    try {
      return readFileSync(reviewNotesPath(groupId), "utf8");
    } catch {
      return "";
    }
  }

  /** The reading guide as the review session has written it so far (empty until
   * it has). Polled by the review pane's Guide tab. */
  readReviewGuide(groupId: string): string {
    try {
      return readFileSync(reviewGuidePath(groupId), "utf8");
    } catch {
      return "";
    }
  }

  /** Write a per-session Claude settings file carrying a review pane's deny
   * backstop + notepad allow (see buildReviewPermissions) and return its path,
   * for `--settings`. */
  private ensureReviewPerms(groupId: string, owned: boolean): string {
    mkdirSync(REVIEW_DIR, { recursive: true });
    const settings = {
      ...paneSettings(groupId, {}, buildReviewPermissions(reviewNotesPath(groupId), reviewGuidePath(groupId), owned, notepadPath(groupId), checkResultPath(groupId))),
    };
    const file = reviewSettingsPath(groupId);
    writeFileSync(file, JSON.stringify(settings, null, 2));
    return file;
  }

  // --- Progress notepad ---
  private ensureNotepad(groupId: string, seed?: string): string {
    mkdirSync(PROGRESS_DIR, { recursive: true });
    const file = notepadPath(groupId);
    if (!existsSync(file)) {
      writeFileSync(file, seed ?? EMPTY_NOTEPAD);
    }
    return file;
  }

  /** When a workspace's ticket description no longer matches the copy den
   * kept, tell the session what changed and swap the new text into the
   * notepad and the copy, so keepTicket keeps the current one (#38). */
  ticketsUpdated(issues: { identifier: string; description?: string }[]): void {
    for (const s of this.sessions.values()) {
      if (s.role !== "main" || s.shell || s.look || s.view || !s.ticket) continue;
      const issue = issues.find((i) => i.identifier === s.ticket);
      if (!issue) continue;
      try {
        const copyFile = ticketCopyPath(s.groupId);
        if (!existsSync(copyFile)) continue;
        const copy = readFileSync(copyFile, "utf8");
        const before = ticketDescription(copy);
        // ticketDetails writes this placeholder for an empty description.
        const after = issue.description?.trim() || "_(no description)_";
        if (before === null || before.replace(/\s+/g, " ") === after.replace(/\s+/g, " ")) continue;
        const updated = copy.replace(before, () => after);
        const notepad = this.readNotepad(s.groupId);
        if (notepad.includes(copy.trim())) this.writeNotepad(s.groupId, notepad.replace(copy.trim(), () => updated.trim()));
        writeFileSync(copyFile, updated);
        s.ticketChanged = true;
        this.tell(
          s.groupId,
          `The description of ${s.ticket} changed since this workspace opened; den updated the ticket in ` +
            `your notepad. What changed:\n${lineChanges(before, after).join("\n")}`,
        );
      } catch (err) {
        logWarn("ticketsUpdated", err);
      }
    }
  }

  /** Put a workspace's ticket back at the end of its notepad if a rewrite
   * dropped it. Only looks again once the notepad has changed. */
  private keepTicket(s: DenSession) {
    if (s.shell || s.role !== "main" || s.look || s.view) return;
    try {
      const file = notepadPath(s.groupId);
      const mtime = statSync(file).mtimeMs;
      if (mtime === s.ticketCheckedMtime) return;
      const copy = ticketCopyPath(s.groupId);
      if (!existsSync(copy)) {
        s.ticketCheckedMtime = mtime;
        return;
      }
      const fixed = restoreTicket(readFileSync(file, "utf8"), readFileSync(copy, "utf8"));
      if (fixed !== null) writeFileSync(file, fixed);
      s.ticketCheckedMtime = statSync(file).mtimeMs;
    } catch {
      // no notepad yet
    }
  }

  /** Tell a workspace's Claude pane something on its next prompt or tool
   * call (see inbox.ts), and nudge the developer if nobody is watching it.
   * Workspace main, my-PR, and review panes have the hooks that deliver it. */
  tell(groupId: string, message: string): void {
    const main = [...this.sessions.values()].find((s) => s.groupId === groupId && s.role === "main");
    if (!main || main.shell || main.look) return;
    tellPane(groupId, message);
    main.nudge();
  }

  /** The panes whose branches den follows for stacks: running workspaces and
   * my-PR panes. */
  stackTargets(baseOverride: string | null): StackTarget[] {
    return [...this.sessions.values()]
      .filter((s) => worksLikeWorkspace(s) && s.status === "running")
      .map((s) => ({ id: s.id, groupId: s.groupId, cwd: s.cwd, base: repoBaseName(s.cwd, baseOverride) }));
  }

  /** Tell every session working on a PR: its my-PR or owned review pane, and
   * any workspace whose checkout is on the PR's branch. */
  tellAboutPr(pr: { repo: string; number: number; branch?: string }, message: string): void {
    for (const s of this.sessions.values()) {
      if (s.role !== "main" || s.shell || s.status !== "running") continue;
      const onPr = s.pr === pr.number && s.prRepo === pr.repo;
      const onBranch = !s.look && !s.view && !!pr.branch && gitBranch(s.cwd) === pr.branch;
      if (onPr || onBranch) this.tell(s.groupId, message);
    }
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
