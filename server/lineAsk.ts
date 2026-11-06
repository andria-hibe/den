// Asking about one line of a PR under review ("why is this here?") without a
// round trip through the review pane: each line gets its own small headless
// Claude conversation, read-only, in the review's checkout, and its answer is
// shown under the line. A follow-up resumes that line's conversation. The
// review pane's own chat is never touched.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./dataDir.ts";
import { logWarn } from "./log.ts";

const REVIEW_DIR = join(DATA_DIR, "review");
const linesPath = (groupId: string) => join(REVIEW_DIR, `${groupId}.lines.json`);

export interface LineMessage {
  from: "you" | "claude";
  text: string;
  at: number;
}

export interface LineThread {
  file: string;
  side: "old" | "new";
  line: number;
  /** The line's text when the thread started, so it can be found again. */
  quote: string;
  /** The headless conversation a follow-up resumes. */
  claudeSessionId: string;
  messages: LineMessage[];
}

export type LineThreads = Record<string, LineThread>;

export const threadKey = (file: string, side: string, line: number) => `${file}:${side}${line}`;

export function readThreads(groupId: string): LineThreads {
  try {
    return JSON.parse(readFileSync(linesPath(groupId), "utf8")) as LineThreads;
  } catch {
    return {};
  }
}

function writeThreads(groupId: string, threads: LineThreads): void {
  mkdirSync(REVIEW_DIR, { recursive: true });
  const file = linesPath(groupId);
  writeFileSync(`${file}.tmp`, JSON.stringify(threads, null, 2));
  renameSync(`${file}.tmp`, file);
}

/** The system prompt for a line question. Plain ASCII, like every prompt den writes. */
export function lineAskInstruction(p: { pr: number | null; diffPath: string; guidePath: string }): string {
  return (
    `You answer a developer's quick questions about one line of a pull request ` +
    `they are reviewing${p.pr ? ` (#${p.pr})` : ""}, inside a tool called den. Your working directory is ` +
    `the PR's checkout. The whole diff is at ${p.diffPath}; a reading guide may be at ` +
    `${p.guidePath}. Read the code around the line, and what calls it, before you ` +
    `answer. Answer in at most five short sentences or bullets, plain ASCII, citing ` +
    `path:line for anything you point at. Say why the code is the way it is when the ` +
    `code or history shows it; if you are guessing, say so. If the line looks wrong, ` +
    `say so plainly. Do not change, run, or post anything.`
  );
}

/** The question as sent: the line, its hunk, and what the developer asked. */
export function lineAskPrompt(t: { file: string; side: "old" | "new"; line: number; quote: string; hunk: string }, question: string): string {
  return (
    `About ${t.file}:${t.line} (${t.side === "old" ? "a removed line, old file numbering" : "new file numbering"}):\n` +
    `    ${t.quote}\n` +
    `Its hunk:\n${t.hunk}\n\n` +
    `Question: ${question}`
  );
}

// Not git log, show, or diff: their --output flag writes a file.
const READ_ONLY = ["Read", "Grep", "Glob", "Bash(git blame:*)"];
/** A backstop under the instruction: it runs in a colleague's checkout, and
 * the developer's own permission mode (auto, for the maintainer) would
 * otherwise let it write. */
const NEVER = ["Edit", "Write", "NotebookEdit", "Bash(git push:*)", "Bash(git commit:*)", "Bash(gh pr:*)", "Bash(gh api:*)"];

/** Lines with a question still being answered: a second ask would resume a
 * conversation that has no transcript yet. */
const answering = new Set<string>();

export class StillAnswering extends Error {}

/** Ask, or follow up on, the question at one line. Resolves with the thread
 * once Claude has answered (or with an error message in its place). */
export function askLine(
  ctx: { groupId: string; cwd: string; pr: number | null; diffPath: string; guidePath: string },
  at: { file: string; side: "old" | "new"; line: number; quote: string; hunk: string },
  question: string,
): Promise<LineThread> {
  const key = threadKey(at.file, at.side, at.line);
  if (answering.has(`${ctx.groupId}:${key}`)) return Promise.reject(new StillAnswering());
  answering.add(`${ctx.groupId}:${key}`);
  const threads = readThreads(ctx.groupId);
  const existing = threads[key];
  const thread: LineThread = existing ?? { ...at, claudeSessionId: randomUUID(), messages: [] };
  const first = !existing;
  thread.messages.push({ from: "you", text: question, at: Date.now() });
  threads[key] = thread;
  writeThreads(ctx.groupId, threads);

  const args = [
    "-p",
    ...(first ? ["--session-id", thread.claudeSessionId] : ["--resume", thread.claudeSessionId]),
    "--model", "sonnet",
    "--effort", "low",
    "--add-dir", REVIEW_DIR,
    "--permission-mode", "default",
    "--allowedTools", ...READ_ONLY,
    "--disallowedTools", ...NEVER,
    "--append-system-prompt", lineAskInstruction(ctx),
    "--", first ? lineAskPrompt(at, question) : question,
  ];
  return new Promise((resolve) => {
    execFile("claude", args, { cwd: ctx.cwd, timeout: 3 * 60_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      answering.delete(`${ctx.groupId}:${key}`);
      const text = err ? "Couldn't get an answer this time; try again." : stdout.trim() || "(no answer)";
      if (err) logWarn("line ask", err);
      // Re-read: another line may have been asked about meanwhile.
      const now = readThreads(ctx.groupId);
      const t = now[key] ?? thread;
      t.messages.push({ from: "claude", text, at: Date.now() });
      now[key] = t;
      writeThreads(ctx.groupId, now);
      resolve(t);
    });
  });
}
