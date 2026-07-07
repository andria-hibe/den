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

// Claude Code stores each session as a JSONL transcript under
// ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl. We read a bit of each to
// recover its working dir and a title so the user can resume it.
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

// den spawns one-shot `claude -p` helpers (PR diff summaries, PR reviews — see
// server/github.ts). Those write transcripts too, but you'd never resume them,
// so we detect them by their prompt and drop them from the resume list.
const HEADLESS_PROMPTS = [
  "Summarize this PR's unified diff",
  "You are reviewing a GitHub pull request",
];
// den's self-edit session opens with a long handover prompt; give it a clean name.
const DEN_SELF_EDIT = "working on **den itself**";

function parse(fp: string): {
  cwd: string | null;
  title: string;
  /** True when this session shouldn't appear in the resume list. */
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

  // Drop from the list: den's one-shot `claude -p` helpers (identified by their
  // prompt), and empty/aborted sessions with no summary and no user prose (e.g.
  // a workspace that was opened but never actually used — pure clutter).
  const headless =
    !!firstUser &&
    HEADLESS_PROMPTS.some((p) => firstUser!.trimStart().startsWith(p));
  const empty = !summary && !firstUser;

  // Title: Claude's own summary, else the first real user message, tidied up.
  let base = summary || firstUser || "(untitled session)";
  if (!summary && firstUser?.includes(DEN_SELF_EDIT)) base = "Editing den itself";
  const title =
    base
      .replace(/\s+/g, " ")
      // drop leading markdown/emoji noise so the first real words show
      .replace(/^[\s>*#`~\-–—.]+/, "")
      .trim()
      .slice(0, 80) || "(untitled session)";
  return { cwd, title, skip: headless || empty };
}

export function listPastSessions(limit = 40): PastSession[] {
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

  // Scan newest-first and collect real sessions until we have `limit`. We may
  // skip many (headless helpers, gone cwds), so scan beyond `limit` — but cap
  // the scan so a huge history doesn't read thousands of files.
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
