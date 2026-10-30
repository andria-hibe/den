// How big a Claude conversation's context is (#45), read from the transcript
// Claude Code writes under ~/.claude/projects.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

interface RawUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
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

/** The input of a conversation's latest turn (fresh, cache read, and cache
 * write tokens): what every further turn sends again, so the chats where it's
 * largest cost the most to keep talking to. Subagent turns don't count. */
export function lastContext(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"usage"')) continue;
    let o: { type?: string; isSidechain?: boolean; message?: { usage?: RawUsage } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const u = o.message?.usage;
    if (o.type !== "assistant" || o.isSidechain || !u) continue;
    return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  }
  return 0;
}

const contextCache = new Map<string, { key: string; tokens: number }>();

/** lastContext for a conversation's own transcript; 0 before the first reply. */
export function contextSize(sessionId: string): number {
  const file = transcriptFiles(sessionId)[0];
  if (!file) return 0;
  try {
    const st = statSync(file);
    const key = `${st.mtimeMs}:${st.size}`;
    let hit = contextCache.get(file);
    if (hit?.key !== key) {
      hit = { key, tokens: lastContext(readFileSync(file, "utf8").split("\n")) };
      contextCache.set(file, hit);
    }
    return hit.tokens;
  } catch {
    return 0;
  }
}
