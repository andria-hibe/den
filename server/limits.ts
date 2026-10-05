// The plan's usage limits (the 5-hour session and the week, as Claude Code's
// /usage shows them). Claude Code hands them only to a status line command,
// as `rate_limits` in its JSON input, and only once a pane has had a reply.
// So every Claude pane den spawns gets a status line that saves that input to
// a file, and den reads the newest one. The limits are the account's, so any
// pane's reading will do.
import os from "node:os";
import { join } from "node:path";
import { readFileSync, readdirSync, statSync, rmSync } from "node:fs";

const LIMITS_DIR = join(os.homedir(), ".den", "limits");

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
): { statusLine: { type: "command"; command: string; padding?: number } } {
  const file = limitsFile(groupId);
  const tmp = `${file}.tmp`;
  const save = `mkdir -p ${quote(LIMITS_DIR)} && cat > ${quote(tmp)} && mv ${quote(tmp)} ${quote(file)}`;
  const command = own ? `${save} && (${own.command}) < ${quote(file)}` : save;
  return {
    statusLine: { type: "command", command, ...(own?.padding !== undefined ? { padding: own.padding } : {}) },
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
  let names: string[];
  try {
    names = readdirSync(LIMITS_DIR).filter((n) => n.endsWith(".json"));
  } catch {
    return null;
  }
  const files = names
    .map((n) => {
      const path = join(LIMITS_DIR, n);
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
  rmSync(file, { force: true });
  rmSync(`${file}.tmp`, { force: true });
}
