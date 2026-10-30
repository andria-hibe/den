// Which crew subagents a pane has at work right now, so its header can light
// their busts. Claude Code tells nobody but its hooks, so SubagentStart and
// SubagentStop hooks in the pane's --settings append their JSON input (one
// line each, carrying agent_id and agent_type) to a log per workspace, and
// den replays it. The log is cleared whenever the pane starts or exits.
import { join } from "node:path";
import { readFileSync, rmSync, statSync } from "node:fs";
import { DATA_DIR } from "./dataDir.ts";

const CREW_DIR = join(DATA_DIR, "crew");

/** An agent with no transcript write for this long is taken to be gone, so a
 * missed SubagentStop can't keep a bust lit until the pane restarts. */
const STALE_MS = 15 * 60_000;

const GROUP_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

const logFile = (groupId: string) => join(CREW_DIR, `${groupId}.jsonl`);

type CrewEvent = "SubagentStart" | "SubagentStop";

/** Hooks for a pane's --settings that log its subagents starting and stopping. */
export function crewHooks(groupId: string): Record<CrewEvent, unknown[]> {
  if (!GROUP_ID_RE.test(groupId)) return { SubagentStart: [], SubagentStop: [] };
  const hook = {
    type: "command",
    command: `mkdir -p ${quote(CREW_DIR)} && { cat; echo; } >> ${quote(logFile(groupId))}`,
  };
  return { SubagentStart: [{ hooks: [hook] }], SubagentStop: [{ hooks: [hook] }] };
}

export interface RunningAgent {
  id: string;
  type: string;
  /** Where Claude Code writes the subagent's transcript. */
  transcript: string | null;
}

/** The subagents a hook log has started and not stopped, oldest first. */
export function runningAgents(log: string): RunningAgent[] {
  const running = new Map<string, RunningAgent>();
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    let e: { hook_event_name?: unknown; agent_id?: unknown; agent_type?: unknown; transcript_path?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof e.agent_id !== "string") continue;
    if (e.hook_event_name === "SubagentStop") {
      running.delete(e.agent_id);
    } else if (e.hook_event_name === "SubagentStart" && typeof e.agent_type === "string") {
      // Only the SubagentStop input carries agent_transcript_path; this is where it points.
      const transcript =
        typeof e.transcript_path === "string"
          ? `${e.transcript_path.replace(/\.jsonl$/, "")}/subagents/agent-${e.agent_id}.jsonl`
          : null;
      running.set(e.agent_id, { id: e.agent_id, type: e.agent_type, transcript });
    }
  }
  return [...running.values()];
}

const mtime = (file: string): number | null => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

/** The agent types (e.g. "badger") a workspace's pane has at work. */
export function activeCrew(groupId: string, now = Date.now()): string[] {
  if (!GROUP_ID_RE.test(groupId)) return [];
  const file = logFile(groupId);
  let log: string;
  try {
    log = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const logAt = mtime(file) ?? 0;
  const types = runningAgents(log)
    .filter((a) => now - ((a.transcript ? mtime(a.transcript) : null) ?? logAt) < STALE_MS)
    .map((a) => a.type);
  return [...new Set(types)];
}

export function clearCrew(groupId: string): void {
  if (!GROUP_ID_RE.test(groupId)) return;
  rmSync(logFile(groupId), { force: true });
}
