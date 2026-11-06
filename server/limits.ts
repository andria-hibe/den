// The plan's usage limits (the 5-hour session and the week, as Claude Code's
// /usage shows them). Claude Code hands them only to a status line command,
// as `rate_limits` in its JSON input, and only once a pane has had a reply.
// So every Claude pane den spawns gets a status line that saves that input to
// a file, and den reads the newest one. The limits are the account's, so any
// pane's reading will do.
import os from "node:os";
import { join } from "node:path";
import { readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { DATA_DIR } from "./dataDir.ts";

const LIMITS_DIR = join(DATA_DIR, "limits");

const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export interface LimitWindow {
  usedPercentage: number;
  /** Epoch ms. */
  resetsAt: number;
}

export interface PlanLimits {
  session: LimitWindow | null;
  week: LimitWindow | null;
  /** When Claude Code last reported them, epoch ms. */
  at: number;
}

/** `groupId` is validated by the caller (notepadPath and friends). */
function limitsFile(groupId: string): string {
  return join(LIMITS_DIR, `${groupId}.json`);
}

interface OwnStatusLine {
  command: string;
  padding?: number;
}

/** The developer's own status line, which den's must keep running. */
function ownStatusLine(): OwnStatusLine | null {
  try {
    const settings = JSON.parse(
      readFileSync(join(os.homedir(), ".claude", "settings.json"), "utf8"),
    ) as { statusLine?: { type?: string; command?: unknown; padding?: unknown } };
    const sl = settings.statusLine;
    if (sl?.type !== "command" || typeof sl.command !== "string" || !sl.command.trim()) return null;
    return { command: sl.command, ...(typeof sl.padding === "number" ? { padding: sl.padding } : {}) };
  } catch {
    return null;
  }
}

/** Settings for a pane's `--settings`: a status line that saves its input
 * atomically (a half-written file would read as no limits), then hands it to
 * the developer's own status line command, if any. */
export function statusLineSettings(
  groupId: string,
  own: OwnStatusLine | null = ownStatusLine(),
): { statusLine: { type: "command"; command: string; padding?: number; refreshInterval: number } } {
  const file = limitsFile(groupId);
  const tmp = `${file}.tmp`;
  const save = `mkdir -p ${quote(LIMITS_DIR)} && cat > ${quote(tmp)} && mv ${quote(tmp)} ${quote(file)}`;
  const command = own ? `${save} && (${own.command}) < ${quote(file)}` : save;
  return {
    // Status line input arrives only on events, so an idle pane's limits and
    // cache state would go stale; this re-runs it every 30 seconds.
    statusLine: { type: "command", command, refreshInterval: 30, ...(own?.padding !== undefined ? { padding: own.padding } : {}) },
  };
}

function window(raw: unknown): LimitWindow | null {
  const w = raw as { used_percentage?: unknown; resets_at?: unknown } | undefined;
  if (typeof w?.used_percentage !== "number" || typeof w.resets_at !== "number") return null;
  return { usedPercentage: w.used_percentage, resetsAt: w.resets_at * 1000 };
}

/** The limits from a status line's JSON input, or null before the pane's
 * first reply (Claude Code leaves `rate_limits` out until then). */
export function parseLimits(json: string, at: number): PlanLimits | null {
  try {
    const rl = (JSON.parse(json) as { rate_limits?: { five_hour?: unknown; seven_day?: unknown } })
      .rate_limits;
    const session = window(rl?.five_hour);
    const week = window(rl?.seven_day);
    return session || week ? { session, week, at } : null;
  } catch {
    return null;
  }
}

/** The newest reading any pane has saved. */
export function readLimits(): PlanLimits | null {
  const paths: string[] = [];
  try {
    for (const n of readdirSync(LIMITS_DIR)) if (n.endsWith(".json")) paths.push(join(LIMITS_DIR, n));
  } catch {
    // no pane has saved a reading
  }
  const files = paths
    .map((path) => {
      try {
        return { path, mtime: statSync(path).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((f) => f !== null)
    .sort((a, b) => b.mtime - a.mtime);
  for (const f of files) {
    try {
      const limits = parseLimits(readFileSync(f.path, "utf8"), f.mtime);
      if (limits) return limits;
    } catch {
      // removed since the listing
    }
  }
  return null;
}

export function removeLimits(groupId: string): void {
  const file = limitsFile(groupId);
  contextCache.delete(groupId);
  rmSync(file, { force: true });
  rmSync(`${file}.tmp`, { force: true });
}

/** How full one pane's context window is, from the same status line input. */
export interface PaneContext {
  usedPercentage: number;
  tokens: number;
  windowSize: number;
  /** When the conversation's prompt cache lapses, epoch ms; null if unknown. */
  cacheExpiresAt: number | null;
  /** What the next turn re-reads at full price once the cache has lapsed. */
  recacheTokens: number;
}

/** The context reading in a status line's input, or null when it belongs to
 * another conversation (a pane started fresh keeps the old file until its
 * first reply) or Claude Code left it out. */
export function parseContext(json: string, sessionId: string | null): PaneContext | null {
  try {
    const d = JSON.parse(json) as {
      session_id?: unknown;
      context_window?: {
        used_percentage?: unknown;
        context_window_size?: unknown;
        total_input_tokens?: unknown;
      };
      prompt_cache?: { expires_at?: unknown; recache_tokens_if_cold?: unknown };
    };
    if (sessionId && d.session_id !== sessionId) return null;
    const cw = d.context_window;
    if (typeof cw?.used_percentage !== "number" || typeof cw.context_window_size !== "number") return null;
    return {
      usedPercentage: cw.used_percentage,
      tokens: typeof cw.total_input_tokens === "number" ? cw.total_input_tokens : 0,
      windowSize: cw.context_window_size,
      cacheExpiresAt: typeof d.prompt_cache?.expires_at === "number" ? d.prompt_cache.expires_at * 1000 : null,
      recacheTokens: typeof d.prompt_cache?.recache_tokens_if_cold === "number" ? d.prompt_cache.recache_tokens_if_cold : 0,
    };
  } catch {
    return null;
  }
}

const contextCache = new Map<string, { mtime: number; sessionId: string | null; value: PaneContext | null }>();

/** A pane's context reading, re-read only when its file changes, since the
 * session list asks for every pane every few seconds. */
export function readPaneContext(groupId: string, sessionId: string | null): PaneContext | null {
  const file = limitsFile(groupId);
  let mtime: number;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    contextCache.delete(groupId);
    return null;
  }
  const hit = contextCache.get(groupId);
  if (hit && hit.mtime === mtime && hit.sessionId === sessionId) return hit.value;
  let value: PaneContext | null = null;
  try {
    value = parseContext(readFileSync(file, "utf8"), sessionId);
  } catch {
    // removed since the stat
  }
  contextCache.set(groupId, { mtime, sessionId, value });
  return value;
}
