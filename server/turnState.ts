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

export type TurnState = "working" | "done" | "needs-you";

export interface Turn {
  state: TurnState;
  /** When the hook wrote it, epoch ms. */
  at: number;
  /** What Claude Code said it needs, for "needs-you". */
  message: string | null;
}

/** Notification types that mean the pane is waiting on the developer; the
 * rest (auth_success, quota notices, ...) would overwrite a real state. */
const NEEDS_YOU = "permission_prompt|idle_prompt|elicitation_dialog|elicitation_url_dialog|agent_needs_input";

/** Hooks for a pane's --settings that save each event's input to the pane's
 * turn file (tmp + mv, so den never reads half a file). */
export function turnHooks(groupId: string): Record<string, unknown[]> {
  if (!GROUP_ID_RE.test(groupId)) return {};
  const file = turnFile(groupId);
  const hook = { type: "command", command: `mkdir -p ${quote(TURN_DIR)} && cat > ${quote(`${file}.tmp`)} && mv ${quote(`${file}.tmp`)} ${quote(file)}` };
  return {
    UserPromptSubmit: [{ hooks: [hook] }],
    PostToolUse: [{ matcher: "", hooks: [hook] }],
    Stop: [{ hooks: [hook] }],
    Notification: [{ matcher: NEEDS_YOU, hooks: [hook] }],
  };
}

/** A hook's input as a turn, or null for another conversation's file or an
 * event that says nothing about the turn. */
export function parseTurn(json: string, at: number, sessionId: string | null): Turn | null {
  try {
    const d = JSON.parse(json) as { session_id?: string; hook_event_name?: string; message?: string; agent_id?: string };
    if (sessionId && d.session_id !== sessionId) return null;
    switch (d.hook_event_name) {
      case "UserPromptSubmit":
      case "PostToolUse":
        return { state: "working", at, message: null };
      case "Stop":
        return { state: "done", at, message: null };
      case "Notification":
        return { state: "needs-you", at, message: typeof d.message === "string" ? d.message : null };
      default:
        return null;
    }
  } catch {
    return null;
  }
}

const cache = new Map<string, { key: string; turn: Turn | null }>();

/** The pane's latest turn state, re-read only when the file changes. */
export function readTurn(groupId: string, sessionId: string | null): Turn | null {
  try {
    const file = turnFile(groupId);
    const mtime = statSync(file).mtimeMs;
    const key = `${mtime}:${sessionId}`;
    const hit = cache.get(groupId);
    if (hit?.key === key) return hit.turn;
    const turn = parseTurn(readFileSync(file, "utf8"), mtime, sessionId);
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
}

/** Combine several hook sets into one `hooks` object, appending the entries
 * for an event that more than one set uses. */
export function mergeHooks(...sets: Record<string, unknown[]>[]): Record<string, unknown[]> {
  const out: Record<string, unknown[]> = {};
  for (const set of sets) for (const [event, entries] of Object.entries(set)) out[event] = [...(out[event] ?? []), ...entries];
  return out;
}
