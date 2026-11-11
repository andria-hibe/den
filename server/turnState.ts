// Where each Claude pane's turn is, from Claude Code's own hooks: a prompt
// submitted or a tool run means working, Stop means the turn finished, and a
// Notification means it is waiting on the developer (a permission prompt, a
// question). Before these, den guessed from the terminal title's spinner and
// from output going quiet, which can't tell a finished turn from a permission
// prompt.
import { mkdirSync, readFileSync, rmSync, statSync, watch } from "node:fs";
import { logWarn } from "./log.ts";
import { join } from "node:path";
import { DATA_DIR } from "./dataDir.ts";

const TURN_DIR = join(DATA_DIR, "turn");
const GROUP_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export const turnFile = (groupId: string) => join(TURN_DIR, `${groupId}.json`);
/** The pane's latest PermissionRequest input (the tool and what it would
 * do), kept apart from the turn file: the permission prompt's Notification,
 * which arrives seconds later, names neither. */
const toolFile = (groupId: string) => join(TURN_DIR, `${groupId}.tool.json`);

export type TurnState = "working" | "done" | "needs-you";

export interface Turn {
  state: TurnState;
  /** When the hook wrote it, epoch ms. */
  at: number;
  /** What Claude Code said it needs, for "needs-you". */
  message: string | null;
  /** One line for the rail: what a permission prompt would run, or how a
   * finished turn ended. */
  detail: string | null;
}

const DETAIL_MAX = 140;

function oneLine(s: string): string {
  const flat = s.replace(/\s+/g, " ").replace(/[\x00-\x1f\x7f]/g, "").trim();
  return flat.length > DETAIL_MAX ? `${flat.slice(0, DETAIL_MAX - 3)}...` : flat;
}

/** What a tool call would do, in a few words: its name and main argument. */
export function toolSummary(name: unknown, input: unknown): string | null {
  if (typeof name !== "string") return null;
  const i = (input ?? {}) as Record<string, unknown>;
  const arg = [i.command, i.file_path, i.notebook_path, i.url, i.query, i.pattern, i.description].find(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
  const tool = name.startsWith("mcp__") ? name.slice(5).replace("__", " ") : name;
  return oneLine(arg ? `${tool}: ${arg}` : tool);
}

/** Notification types that mean the pane is waiting on the developer; the
 * rest (auth_success, quota notices, ...) would overwrite a real state.
 * Not idle_prompt: it fires a minute after every finished turn, which would
 * turn every idle pane into one "waiting on you". */
const NEEDS_YOU = "permission_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input";

/** Hooks for a pane's --settings that save each event's input to the pane's
 * turn file (tmp + mv, so den never reads half a file). */
export function turnHooks(groupId: string): Record<string, unknown[]> {
  if (!GROUP_ID_RE.test(groupId)) return {};
  const file = turnFile(groupId);
  const save = (to: string) => ({
    type: "command",
    command: `mkdir -p ${quote(TURN_DIR)} && cat > ${quote(`${to}.tmp`)} && mv ${quote(`${to}.tmp`)} ${quote(to)}`,
  });
  const hook = save(file);
  return {
    UserPromptSubmit: [{ hooks: [hook] }],
    // The turn file too, so the rail flags the prompt as it appears.
    PermissionRequest: [{ matcher: "", hooks: [save(toolFile(groupId)), hook] }],
    PostToolUse: [{ matcher: "", hooks: [hook] }],
    Stop: [{ hooks: [hook] }],
    Notification: [{ matcher: NEEDS_YOU, hooks: [hook] }],
  };
}

/** A hook's input as a turn, or null for another conversation's file or an
 * event that says nothing about the turn. `lastTool` reads the saved
 * PermissionRequest input, to say what a permission prompt is for. */
export function parseTurn(
  json: string,
  at: number,
  sessionId: string | null,
  lastTool: () => string | null = () => null,
): Turn | null {
  try {
    const d = JSON.parse(json) as {
      session_id?: string; hook_event_name?: string; message?: string;
      notification_type?: string; last_assistant_message?: string;
      tool_name?: unknown; tool_input?: unknown;
    };
    if (sessionId && d.session_id !== sessionId) return null;
    switch (d.hook_event_name) {
      case "UserPromptSubmit":
      case "PostToolUse":
        return { state: "working", at, message: null, detail: null };
      case "Stop": {
        const last = typeof d.last_assistant_message === "string" ? oneLine(d.last_assistant_message) : "";
        return { state: "done", at, message: null, detail: last || null };
      }
      case "PermissionRequest":
        return { state: "needs-you", at, message: null, detail: toolSummary(d.tool_name, d.tool_input) };
      case "Notification": {
        const message = typeof d.message === "string" ? d.message : null;
        return { state: "needs-you", at, message, detail: d.notification_type === "permission_prompt" ? toolDetail(lastTool, d.session_id) : null };
      }
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/** The tool call the latest permission prompt is for, if it's this
 * conversation's. */
function toolDetail(lastTool: () => string | null, sessionId: string | undefined): string | null {
  const saved = lastTool();
  if (!saved) return null;
  try {
    const t = JSON.parse(saved) as { session_id?: string; tool_name?: unknown; tool_input?: unknown };
    return t.session_id === sessionId ? toolSummary(t.tool_name, t.tool_input) : null;
  } catch {
    return null;
  }
}

/** How long before its notification a permission request can be (seen: ~6s). */
const TOOL_FRESH_MS = 60_000;

const cache = new Map<string, { key: string; turn: Turn | null }>();

/** The pane's latest turn state, re-read only when the file changes. */
export function readTurn(groupId: string, sessionId: string | null): Turn | null {
  try {
    const file = turnFile(groupId);
    const mtime = statSync(file).mtimeMs;
    const key = `${mtime}:${sessionId}`;
    const hit = cache.get(groupId);
    if (hit?.key === key) return hit.turn;
    const lastTool = () => {
      try {
        // A prompt that isn't for a tool must not show the last tool's command.
        if (mtime - statSync(toolFile(groupId)).mtimeMs > TOOL_FRESH_MS) return null;
        return readFileSync(toolFile(groupId), "utf8");
      } catch {
        return null;
      }
    };
    const turn = parseTurn(readFileSync(file, "utf8"), mtime, sessionId, lastTool);
    cache.set(groupId, { key, turn });
    return turn;
  } catch {
    return null;
  }
}

/** Call `onChange(groupId)` as soon as a pane's hook writes its turn file,
 * so the rail flags a finished turn without waiting for den's next tick. */
export function watchTurns(onChange: (groupId: string) => void): void {
  try {
    mkdirSync(TURN_DIR, { recursive: true });
    watch(TURN_DIR, (_event, name) => {
      const m = name && /^([A-Za-z0-9-]{1,64})\.json$/.exec(String(name));
      if (m) onChange(m[1]);
    }).unref();
  } catch (err) {
    logWarn("turn watch", err);
  }
}

export function removeTurn(groupId: string): void {
  cache.delete(groupId);
  rmSync(turnFile(groupId), { force: true });
  rmSync(toolFile(groupId), { force: true });
}

/** Combine several hook sets into one `hooks` object, appending the entries
 * for an event that more than one set uses. */
export function mergeHooks(...sets: Record<string, unknown[]>[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const set of sets) for (const [event, entries] of Object.entries(set)) out[event] = [...(out[event] ?? []), ...entries];
  return out;
}
