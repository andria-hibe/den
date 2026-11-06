// Which crew subagents a pane has at work right now, so its header can light
// their busts. Claude Code tells nobody but its hooks, so SubagentStart and
// SubagentStop hooks in the pane's --settings append their JSON input (one
// line each, carrying agent_id and agent_type) to a log per workspace, and
// den replays it. The log is cleared whenever the pane starts or exits.
import { join } from "node:path";
import { closeSync, openSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";
import { DATA_DIR } from "./dataDir.ts";

const CREW_DIR = join(DATA_DIR, "crew");

/** An agent with no transcript write for this long is taken to be gone, so a
 * missed SubagentStop can't keep a bust lit until the pane restarts. */
const STALE_MS = 15 * 60_000;

const GROUP_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

const logFile = (groupId: string) => join(CREW_DIR, `${groupId}.jsonl`);
/** Every finished subagent run, kept across pane restarts until the
 * workspace closes, so the developer can see what each helper did. */
const runsFile = (groupId: string) => join(CREW_DIR, `${groupId}.runs.jsonl`);

type CrewEvent = "SubagentStart" | "SubagentStop";

/** Hooks for a pane's --settings that log its subagents starting and stopping. */
export function crewHooks(groupId: string): Record<CrewEvent, unknown[]> {
  if (!GROUP_ID_RE.test(groupId)) return { SubagentStart: [], SubagentStop: [] };
  const hook = {
    type: "command",
    command: `mkdir -p ${quote(CREW_DIR)} && { cat; echo; } >> ${quote(logFile(groupId))}`,
  };
  const stop = {
    type: "command",
    command: `mkdir -p ${quote(CREW_DIR)} && line=$(cat) && printf '%s\\n' "$line" >> ${quote(logFile(groupId))} && printf '%s\\n' "$line" >> ${quote(runsFile(groupId))}`,
  };
  return { SubagentStart: [{ hooks: [hook] }], SubagentStop: [{ hooks: [stop] }] };
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

export interface CrewRun {
  id: string;
  type: string;
  model: string | null;
  startedAt: number | null;
  endedAt: number | null;
  toolUses: number;
  /** What it was asked: the brief it got. */
  brief: string;
  /** What it said back: its final message. */
  report: string;
  /** The shell commands it ran, in order (at most MAX_COMMANDS). */
  commands: string[];
}

const MAX_COMMANDS = 15;
const MAX_TEXT = 6000;

/** One subagent run, read from its transcript. */
export function summarizeRun(id: string, type: string, transcript: string): CrewRun {
  const run: CrewRun = { id, type, model: null, startedAt: null, endedAt: null, toolUses: 0, brief: "", report: "", commands: [] };
  let handedBack = false;
  const text = (content: unknown): string =>
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((c: { type?: string; text?: string }) => (c?.type === "text" ? (c.text ?? "") : "")).join("")
        : "";
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let o: { type?: string; timestamp?: string; message?: { role?: string; model?: string; content?: unknown } };
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const at = o.timestamp ? Date.parse(o.timestamp) : NaN;
    if (!Number.isNaN(at)) {
      run.startedAt ??= at;
      run.endedAt = at;
    }
    if (o.type === "user" && !run.brief) run.brief = text(o.message?.content).slice(0, MAX_TEXT);
    if (o.type === "assistant") {
      run.model = o.message?.model ?? run.model;
      const said = text(o.message?.content);
      if (said.trim() && !handedBack) run.report = said.slice(0, MAX_TEXT);
      for (const c of Array.isArray(o.message?.content) ? (o.message!.content as { type?: string; name?: string; input?: { command?: string; message?: string } }[]) : []) {
        if (c.type !== "tool_use") continue;
        // A background subagent hands its report back through this tool.
        if (c.name === "SubagentHandback" && c.input?.message) {
          run.report = c.input.message.slice(0, MAX_TEXT);
          handedBack = true;
          continue;
        }
        run.toolUses++;
        if (c.name === "Bash" && c.input?.command && run.commands.length < MAX_COMMANDS) run.commands.push(c.input.command.slice(0, 300));
      }
    }
  }
  return run;
}

/** A workspace's finished subagent runs, newest first. */
export function crewRuns(groupId: string, limit = 20): CrewRun[] {
  if (!GROUP_ID_RE.test(groupId)) return [];
  let log: string;
  try {
    log = readFileSync(runsFile(groupId), "utf8");
  } catch {
    return [];
  }
  const out: CrewRun[] = [];
  const lines = log.split("\n").filter((l) => l.trim());
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    let e: { agent_id?: unknown; agent_type?: unknown; agent_transcript_path?: unknown };
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (typeof e.agent_id !== "string" || typeof e.agent_transcript_path !== "string") continue;
    const transcript = readTranscript(e.agent_transcript_path);
    out.push(summarizeRun(e.agent_id, typeof e.agent_type === "string" ? e.agent_type : "?", transcript));
  }
  return out;
}

const PROJECTS = resolve(homedir(), ".claude", "projects") + sep;
/** Enough of a long run to find its brief, commands, and report. */
const MAX_TRANSCRIPT = 2 * 1024 * 1024;

/** A subagent transcript the runs log names, read only when it is where
 * Claude Code keeps transcripts: the log is a file any pane could write. The
 * head and the tail of a long one hold its brief and its report. */
function readTranscript(path: string): string {
  const p = resolve(path);
  if (!p.startsWith(PROJECTS) || !p.endsWith(".jsonl")) return "";
  try {
    const size = statSync(p).size;
    if (size <= MAX_TRANSCRIPT) return readFileSync(p, "utf8");
    const fd = openSync(p, "r");
    try {
      const half = MAX_TRANSCRIPT / 2;
      const head = Buffer.alloc(half);
      const tail = Buffer.alloc(half);
      readSync(fd, head, 0, half, 0);
      readSync(fd, tail, 0, half, size - half);
      return `${head.toString("utf8")}\n${tail.toString("utf8")}`;
    } finally {
      closeSync(fd);
    }
  } catch {
    return ""; // transcript gone: list the run with what the hook said
  }
}

/** A workspace's finished runs of the agent `types` not yet `seen`,
 * oldest first: only these have their transcripts read. A run whose
 * transcript can't be read yet is left for the next call. */
export function newCrewRuns(groupId: string, types: ReadonlySet<string>, seen: (id: string) => boolean): CrewRun[] {
  if (!GROUP_ID_RE.test(groupId)) return [];
  let log: string;
  try {
    log = readFileSync(runsFile(groupId), "utf8");
  } catch {
    return [];
  }
  const out: CrewRun[] = [];
  for (const line of log.split("\n")) {
    if (!line.trim()) continue;
    let e: { agent_id?: unknown; agent_type?: unknown; agent_transcript_path?: unknown };
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof e.agent_id !== "string" || typeof e.agent_transcript_path !== "string") continue;
    if (typeof e.agent_type !== "string" || !types.has(e.agent_type) || seen(e.agent_id)) continue;
    const transcript = readTranscript(e.agent_transcript_path);
    if (transcript.trim()) out.push(summarizeRun(e.agent_id, e.agent_type, transcript));
  }
  return out;
}

export function removeCrewRuns(groupId: string): void {
  if (!GROUP_ID_RE.test(groupId)) return;
  rmSync(runsFile(groupId), { force: true });
}

export function clearCrew(groupId: string): void {
  if (!GROUP_ID_RE.test(groupId)) return;
  rmSync(logFile(groupId), { force: true });
}
