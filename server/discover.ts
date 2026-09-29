import {
  existsSync,
  readdirSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Transcripts live at <PROJECTS>/<encoded-cwd>/<session-id>.jsonl.
const PROJECTS = join(homedir(), ".claude", "projects");

export interface PastSession {
  sessionId: string;
  cwd: string;
  title: string;
  updatedAt: number;
}

function readHead(fp: string, bytes = 131072): string {
  const fd = openSync(fp, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function userText(msg: unknown): string | null {
  if (!msg || typeof msg !== "object") return null;
  const content = (msg as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const block = content.find(
      (b) => b && typeof b === "object" && (b as { type?: string }).type === "text",
    ) as { text?: string } | undefined;
    return block?.text ?? null;
  }
  return null;
}

// Opening prompts of den's retired one-shot `claude -p` helpers. Their
// transcripts are still on disk and never worth resuming.
const HEADLESS_PROMPTS = [
  "Summarize this PR's unified diff",
  "You are reviewing a GitHub pull request",
];
// den's self-edit session opens with a long handover prompt; give it a clean name.
const DEN_SELF_EDIT = "working on **den itself**";

/** Collapse whitespace, strip leading markdown/emoji noise, cap at 80 chars. */
export function tidyTitle(base: string): string {
  return (
    base
      .replace(/\s+/g, " ")
      .replace(/^[\s>*#`~\-–—.]+/, "")
      .trim()
      .slice(0, 80) || "(untitled session)"
  );
}

function parse(fp: string): {
  cwd: string | null;
  title: string;
  skip: boolean;
} {
  let cwd: string | null = null;
  let summary: string | null = null;
  let firstUser: string | null = null;
  const head = readHead(fp).split("\n");
  head.pop(); // possibly-truncated last line
  for (const line of head) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (!cwd && typeof o.cwd === "string") cwd = o.cwd;
    if (!summary && o.type === "summary" && typeof o.summary === "string") {
      summary = o.summary;
    }
    if (!firstUser && o.type === "user") {
      const t = userText(o.message);
      // skip slash-commands / internal tags
      if (t && !t.trimStart().startsWith("<") && !t.trimStart().startsWith("/")) {
        firstUser = t;
      }
    }
    if (cwd && (summary || firstUser)) break;
  }

  // An empty session is a workspace opened but never used.
  const headless =
    !!firstUser &&
    HEADLESS_PROMPTS.some((p) => firstUser!.trimStart().startsWith(p));
  const empty = !summary && !firstUser;

  let base = summary || firstUser || "(untitled session)";
  if (!summary && firstUser?.includes(DEN_SELF_EDIT)) base = "Editing den itself";
  return { cwd, title: tidyTitle(base), skip: headless || empty };
}

/** All Claude transcripts on disk, newest-first (by mtime). */
function allTranscripts(): { fp: string; id: string; mtime: number }[] {
  if (!existsSync(PROJECTS)) return [];
  const files: { fp: string; id: string; mtime: number }[] = [];
  for (const dir of readdirSync(PROJECTS)) {
    const dp = join(PROJECTS, dir);
    try {
      if (!statSync(dp).isDirectory()) continue;
    } catch {
      continue;
    }
    for (const f of readdirSync(dp)) {
      if (!f.endsWith(".jsonl")) continue;
      const fp = join(dp, f);
      try {
        files.push({ fp, id: f.slice(0, -6), mtime: statSync(fp).mtimeMs });
      } catch {
        // skip
      }
    }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  return files;
}

/** Does `claude --resume <id>` have a conversation to resume? */
export function hasSession(id: string): boolean {
  if (!id || !existsSync(PROJECTS)) return false;
  for (const dir of readdirSync(PROJECTS)) {
    try {
      if (existsSync(join(PROJECTS, dir, `${id}.jsonl`))) return true;
    } catch {
      // skip unreadable dir
    }
  }
  return false;
}

/** The newest resumable session recorded in this cwd: a best guess for a pane
 * from before den pinned session ids. */
export function latestSessionForCwd(cwd: string): string | null {
  if (!cwd) return null;
  for (const { fp, id } of allTranscripts().slice(0, 400)) {
    try {
      const { cwd: c, skip } = parse(fp);
      if (!skip && c === cwd) return id;
    } catch {
      // skip unreadable
    }
  }
  return null;
}

export function listPastSessions(limit = 40): PastSession[] {
  const files = allTranscripts();

  // Skipped sessions mean scanning past `limit`, capped so a huge history
  // doesn't read thousands of files.
  const out: PastSession[] = [];
  for (const { fp, id, mtime } of files.slice(0, Math.max(limit * 6, 200))) {
    if (out.length >= limit) break;
    try {
      const { cwd, title, skip } = parse(fp);
      if (skip) continue;
      if (cwd && existsSync(cwd)) {
        out.push({ sessionId: id, cwd, title, updatedAt: mtime });
      }
    } catch {
      // skip unreadable
    }
  }
  return out;
}
