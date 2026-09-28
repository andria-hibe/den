// What a Claude session has spent (#11), read from the transcript Claude Code
// writes under ~/.claude/projects, and priced at Anthropic's API rates. On a
// subscription plan that's a proxy rather than a bill, but it's the number
// that shows which sessions are expensive.
//
// Claude Code writes one transcript line per content block, each repeating the
// message's usage, so usage is deduped by message id before summing. Claude
// Code's own total (a `cost-state` line) is only written when the process
// exits, so it can't show a live session.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Dollars per million tokens. Cache writes are 1.25x input for the 5-minute
 * TTL and 2x for 1 hour; cache reads are 0.1x input, except where a model's
 * rate differs (Fable 5.1, Opus 5.5). No long-context premium on these
 * models. Longest id prefix wins, so "claude-opus-5-5" beats "claude-opus-5".
 * Checked 2026-09-28 against Claude Code's own recorded total for a session:
 * the Opus 5.5 row reproduces it exactly. */
interface Rate {
  input: number;
  output: number;
  cacheRead: number;
}
const RATES: [prefix: string, rate: Rate][] = [
  ["claude-fable-5-1", { input: 10, output: 50, cacheRead: 0.25 }],
  ["claude-mythos-5-1", { input: 10, output: 50, cacheRead: 0.25 }],
  ["claude-fable-5", { input: 10, output: 50, cacheRead: 1 }],
  ["claude-mythos-5", { input: 10, output: 50, cacheRead: 1 }],
  ["claude-opus-5-5", { input: 4, output: 20, cacheRead: 0.2 }],
  ["claude-opus-5", { input: 5, output: 25, cacheRead: 0.5 }],
  ["claude-opus-4", { input: 5, output: 25, cacheRead: 0.5 }],
  ["claude-sonnet-5", { input: 2, output: 10, cacheRead: 0.2 }],
  ["claude-sonnet-4", { input: 3, output: 15, cacheRead: 0.3 }],
  ["claude-haiku-4", { input: 1, output: 5, cacheRead: 0.1 }],
];

export function rateFor(model: string): Rate | null {
  let best: [string, Rate] | null = null;
  for (const entry of RATES) {
    if (model.startsWith(entry[0]) && (!best || entry[0].length > best[0].length)) best = entry;
  }
  return best?.[1] ?? null;
}

export interface Usage {
  /** Estimated cost at API prices, over the models we have rates for. */
  costUSD: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Some usage came from a model with no rate, so costUSD undercounts. */
  unpriced: boolean;
}

export const EMPTY_USAGE: Usage = {
  costUSD: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, unpriced: false,
};

interface RawUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}

/** Sum and price the usage in a transcript's JSONL lines. Pure, for the test. */
export function sumUsage(lines: string[]): Usage {
  // Last line wins per message id: every block of a message repeats its usage.
  const byMessage = new Map<string, { model: string; usage: RawUsage }>();
  let anon = 0;
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let o: { type?: string; message?: { id?: string; model?: string; usage?: RawUsage } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const m = o.message;
    if (o.type !== "assistant" || !m?.usage || !m.model) continue;
    byMessage.set(m.id ?? `anon-${anon++}`, { model: m.model, usage: m.usage });
  }
  const out = { ...EMPTY_USAGE };
  for (const { model, usage: u } of byMessage.values()) {
    const input = u.input_tokens ?? 0;
    const output = u.output_tokens ?? 0;
    const read = u.cache_read_input_tokens ?? 0;
    const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
    const write5m = u.cache_creation
      ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0)
      : (u.cache_creation_input_tokens ?? 0);
    out.input += input;
    out.output += output;
    out.cacheRead += read;
    out.cacheWrite += write5m + write1h;
    const r = rateFor(model);
    if (!r) {
      if (model !== "<synthetic>") out.unpriced = true;
      continue;
    }
    out.costUSD +=
      (input * r.input + output * r.output + read * r.cacheRead +
        write5m * r.input * 1.25 + write1h * r.input * 2) / 1e6;
  }
  return out;
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    costUSD: a.costUSD + b.costUSD,
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    unpriced: a.unpriced || b.unpriced,
  };
}

const PROJECTS = join(homedir(), ".claude", "projects");

/** The session's transcript plus any subagent transcripts beside it. */
function transcriptFiles(sessionId: string): string[] {
  if (!existsSync(PROJECTS)) return [];
  for (const dir of readdirSync(PROJECTS)) {
    const main = join(PROJECTS, dir, `${sessionId}.jsonl`);
    if (!existsSync(main)) continue;
    const files = [main];
    const sub = join(PROJECTS, dir, sessionId, "subagents");
    try {
      for (const f of readdirSync(sub)) if (f.endsWith(".jsonl")) files.push(join(sub, f));
    } catch {
      // no subagents
    }
    return files;
  }
  return [];
}

// Transcripts run to megabytes, so each file is parsed again only when it changes.
const cache = new Map<string, { key: string; usage: Usage }>();

/** What a Claude conversation has spent so far. Empty when there's no
 * transcript yet (nothing said in the pane). */
export function sessionUsage(sessionId: string): Usage {
  let total = { ...EMPTY_USAGE };
  for (const file of transcriptFiles(sessionId)) {
    try {
      const st = statSync(file);
      const key = `${st.mtimeMs}:${st.size}`;
      let hit = cache.get(file);
      if (hit?.key !== key) {
        hit = { key, usage: sumUsage(readFileSync(file, "utf8").split("\n")) };
        cache.set(file, hit);
      }
      total = addUsage(total, hit.usage);
    } catch {
      // unreadable or mid-rotation: count what we can
    }
  }
  return total;
}
