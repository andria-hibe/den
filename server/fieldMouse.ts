// The field mouse watches token use (#45): the plan's limits as panes report
// them, and which sessions are spending. It flags a 5-hour window or a week
// set to run out before it resets, and a sudden jump, so a runaway (a big
// workflow, a pane looping on a failing test) is caught while it's running
// rather than when the limit hits.
import { existsSync, mkdirSync, openSync, readSync, closeSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";
import { weekPace, type Pace } from "../shared/pace.ts";
import { DATA_DIR } from "./dataDir.ts";
import type { PlanLimits } from "./limits.ts";
import { logWarn } from "./log.ts";

/** One reading of the plan's limits, as kept in the history. */
export interface Reading {
  at: number;
  session: number | null;
  sessionResetsAt: number | null;
  week: number | null;
  weekResetsAt: number | null;
}

export interface Burner {
  id: string;
  name: string;
  /** Share of the recent spend across den's sessions, 0-100. */
  share: number;
}

export type WatchLevel = "ok" | "watch" | "tight";

export interface Alert {
  /** Stable for one situation, so it's announced once, not every minute. */
  key: string;
  level: Exclude<WatchLevel, "ok">;
  message: string;
}

export interface Watch {
  level: WatchLevel;
  alerts: Alert[];
  /** Sessions spending the most in the last RECENT_MS. */
  burners: Burner[];
}

/** How far back "recent" spend and the 5-hour rate look. */
export const RECENT_MS = 30 * 60_000;
/** The shortest stretch a 5-hour rate is worked out over. */
const MIN_RATE_MS = 10 * 60_000;
/** Below this much of the 5-hour window used, a fast rate isn't worth a word. */
const SESSION_FLOOR = 20;
/** A jump in the week's use within an hour that counts as sudden, in points. */
export const WEEK_JUMP = 3;
/** The same for the 5-hour window, within RECENT_MS. */
export const SESSION_JUMP = 25;

const hhmm = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const day = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** What the readings say now. `burners` only names who's spending. */
export function assess(readings: Reading[], now: number, burners: Burner[] = []): Watch {
  const alerts: Alert[] = [];
  const last = readings[readings.length - 1];
  if (!last) return { level: "ok", alerts, burners };

  // The 5-hour window: the rate over the last half hour, carried forward.
  if (last.session !== null && last.sessionResetsAt && last.sessionResetsAt > now) {
    const same = readings.filter((r) => r.sessionResetsAt === last.sessionResetsAt && r.session !== null && r.at >= now - RECENT_MS);
    const first = same[0];
    if (first && last.at - first.at >= MIN_RATE_MS && last.session! > first.session!) {
      const rate = (last.session! - first.session!) / (last.at - first.at);
      const out = last.at + (100 - last.session!) / rate;
      if (last.session! >= SESSION_FLOOR && out < last.sessionResetsAt) {
        alerts.push({
          key: `session-out:${last.sessionResetsAt}`,
          level: "tight",
          message: `The 5-hour window is ${Math.round(last.session!)}% used and at this rate runs out at ${hhmm(out)}, before it resets at ${hhmm(last.sessionResetsAt)}.`,
        });
      }
      if (last.session! - first.session! >= SESSION_JUMP) {
        alerts.push({
          key: `session-jump:${last.sessionResetsAt}:${Math.floor(last.session! / SESSION_JUMP)}`,
          level: "watch",
          message: `The 5-hour window went from ${Math.round(first.session!)}% to ${Math.round(last.session!)}% in ${Math.round((last.at - first.at) / 60_000)} minutes.`,
        });
      }
    }
  }

  // The week: on top of the even-pace check, a sudden jump within the hour.
  if (last.week !== null && last.weekResetsAt && last.weekResetsAt > now) {
    const pace: Pace = weekPace(last.week, last.weekResetsAt, last.at);
    // weekPace projects a run-out for any use over the even line; only one
    // past its margin ("ahead") is worth calling tight.
    if (pace.status === "ahead" && pace.runsOutAt && pace.runsOutAt < last.weekResetsAt) {
      alerts.push({
        key: `week-out:${last.weekResetsAt}`,
        level: "tight",
        message: `This week is ${Math.round(pace.used)}% used (an even pace would be ${Math.round(pace.expected)}%) and at this rate runs out ${day(pace.runsOutAt)}, before it resets ${day(last.weekResetsAt)}.`,
      });
    } else if (pace.status === "ahead") {
      alerts.push({
        key: `week-ahead:${last.weekResetsAt}`,
        level: "watch",
        message: `This week is ${Math.round(pace.used)}% used, ahead of an even pace (${Math.round(pace.expected)}%).`,
      });
    }
    const hourAgo = readings.find((r) => r.weekResetsAt === last.weekResetsAt && r.week !== null && r.at >= now - 60 * 60_000);
    if (hourAgo && last.week - hourAgo.week! >= WEEK_JUMP) {
      alerts.push({
        key: `week-jump:${last.weekResetsAt}:${Math.floor(last.week / WEEK_JUMP)}`,
        level: "watch",
        message: `This week's use jumped from ${Math.round(hourAgo.week!)}% to ${Math.round(last.week)}% in the last hour.`,
      });
    }
  }

  const level: WatchLevel = alerts.some((a) => a.level === "tight") ? "tight" : alerts.length ? "watch" : "ok";
  return { level, alerts, burners };
}

let latest: Watch = { level: "ok", alerts: [], burners: [] };

/** The field mouse's last assessment (SessionManager.watchTokens). */
export function currentWatch(): Watch {
  return latest;
}

export function setWatch(w: Watch): void {
  latest = w;
}

// --- History -----------------------------------------------------------------

const LEDGER_DIR = join(DATA_DIR, "ledger");
const HISTORY = join(LEDGER_DIR, "readings.json");
/** Kept long enough to look back across a night. */
const KEEP_MS = 26 * 60 * 60_000;

let history: Reading[] | null = null;

function loadHistory(): Reading[] {
  if (history) return history;
  try {
    history = JSON.parse(readFileSync(HISTORY, "utf8")) as Reading[];
  } catch {
    history = [];
  }
  return history;
}

/** Add a reading when it says something new, and return the history. */
export function noteReading(limits: PlanLimits | null, now: number): Reading[] {
  const h = loadHistory();
  if (!limits) return h;
  const r: Reading = {
    at: limits.at,
    session: limits.session?.usedPercentage ?? null,
    sessionResetsAt: limits.session?.resetsAt ?? null,
    week: limits.week?.usedPercentage ?? null,
    weekResetsAt: limits.week?.resetsAt ?? null,
  };
  const last = h[h.length - 1];
  if (last && last.at >= r.at) return h;
  h.push(r);
  history = h.filter((x) => x.at >= now - KEEP_MS);
  try {
    mkdirSync(LEDGER_DIR, { recursive: true });
    writeFileSync(HISTORY, JSON.stringify(history));
  } catch (err) {
    logWarn("field mouse history", err);
  }
  return history;
}

// --- Who's spending -----------------------------------------------------------

const PROJECTS = join(homedir(), ".claude", "projects");

/** Usage weighted by the API's relative prices (input 1, cache write 1.25,
 * cache read 0.1, output 5), so a share means a share of what was spent
 * rather than of tokens re-read from the cache. */
export function weigh(u: {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}): number {
  return (
    (u.input_tokens ?? 0) +
    1.25 * (u.cache_creation_input_tokens ?? 0) +
    0.1 * (u.cache_read_input_tokens ?? 0) +
    5 * (u.output_tokens ?? 0)
  );
}

/** Per transcript file: how far it has been read, and its recent turns. */
const reads = new Map<
  string,
  { offset: number; carry: string; decoder: StringDecoder; turns: Map<string, { at: number; w: number }> }
>();

function readNew(file: string, since: number): number {
  let st;
  try {
    st = statSync(file);
  } catch {
    return 0;
  }
  let r = reads.get(file);
  if (!r || st.size < r.offset) {
    // Only the recent part of a big file matters on first sight.
    r = { offset: Math.max(0, st.size - 4 * 1024 * 1024), carry: "", decoder: new StringDecoder("utf8"), turns: new Map() };
    reads.set(file, r);
  }
  if (st.size > r.offset) {
    const fd = openSync(file, "r");
    try {
      const buf = Buffer.alloc(st.size - r.offset);
      readSync(fd, buf, 0, buf.length, r.offset);
      r.offset = st.size;
      // The decoder holds a character split across two reads.
      const lines = (r.carry + r.decoder.write(buf)).split("\n");
      r.carry = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.includes('"usage"')) continue;
        try {
          const o = JSON.parse(line) as { type?: string; timestamp?: string; message?: { id?: string; usage?: Parameters<typeof weigh>[0] } };
          if (o.type !== "assistant" || !o.message?.usage || !o.timestamp) continue;
          // A turn is written once per content block, with the same usage each time.
          r.turns.set(o.message.id ?? `${o.timestamp}`, { at: Date.parse(o.timestamp), w: weigh(o.message.usage) });
        } catch {
          // a partial or odd line
        }
      }
    } finally {
      closeSync(fd);
    }
  }
  let sum = 0;
  for (const [id, t] of r.turns) {
    if (t.at < since - RECENT_MS) r.turns.delete(id);
    else if (t.at >= since) sum += t.w;
  }
  return sum;
}

/** A conversation's transcript and every subagent and workflow agent under it. */
function conversationFiles(sessionId: string): string[] {
  if (!existsSync(PROJECTS)) return [];
  for (const dir of readdirSync(PROJECTS)) {
    const main = join(PROJECTS, dir, `${sessionId}.jsonl`);
    if (!existsSync(main)) continue;
    const files = [main];
    const walk = (d: string) => {
      let entries;
      try {
        entries = readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (e.name.endsWith(".jsonl")) files.push(join(d, e.name));
      }
    };
    walk(join(PROJECTS, dir, sessionId));
    return files;
  }
  return [];
}

/** Each session's weighted spend since `since`, as shares of the total. */
export function burners(panes: { id: string; name: string; sessionId: string }[], since: number): Burner[] {
  const spent = panes.map((p) => ({
    id: p.id,
    name: p.name,
    w: conversationFiles(p.sessionId).reduce((sum, f) => sum + readNew(f, since), 0),
  }));
  const total = spent.reduce((s, p) => s + p.w, 0);
  if (!total) return [];
  return spent
    .filter((p) => p.w > 0)
    .sort((a, b) => b.w - a.w)
    .map((p) => ({ id: p.id, name: p.name, share: Math.round((p.w / total) * 100) }));
}
