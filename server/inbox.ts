// Telling a running Claude pane something (set up finished, CI finished, a
// base branch moved) without typing into it: a pane at a permission prompt
// looks idle, and a typed Enter would answer the prompt (see the idle
// handover). Instead den leaves the message in an inbox file, and hooks in
// the pane's --settings hand it to Claude as context on its next prompt or
// tool call.
import { join } from "node:path";
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DATA_DIR } from "./edition.ts";

const INBOX_DIR = join(DATA_DIR, "inbox");

const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

type HookEvent = "UserPromptSubmit" | "PostToolUse";
const EVENTS: HookEvent[] = ["UserPromptSubmit", "PostToolUse"];

/** `groupId` is validated by the caller (notepadPath and friends). */
const inboxFile = (groupId: string, event: HookEvent) => join(INBOX_DIR, `${groupId}.${event}.json`);

/** Messages written but not yet picked up, per workspace. */
const pending = new Map<string, string[]>();

/** The hook output that hands `messages` to Claude as context. */
export function hookOutput(event: HookEvent, messages: string[]): string {
  const additionalContext =
    `Messages from den, the app this session runs in:\n` + messages.map((m) => `- ${m}`).join("\n");
  return JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext } });
}

/** Queue a message for a workspace's Claude pane. Each event's hook takes the
 * whole queue and removes the other event's copy, so a message reaches Claude
 * once, on whichever comes first. */
export function tellPane(groupId: string, message: string): void {
  mkdirSync(INBOX_DIR, { recursive: true });
  const taken = EVENTS.every((e) => !existsSync(inboxFile(groupId, e)));
  const messages = [...(taken ? [] : (pending.get(groupId) ?? [])), message];
  pending.set(groupId, messages);
  for (const event of EVENTS) {
    const file = inboxFile(groupId, event);
    writeFileSync(`${file}.tmp`, hookOutput(event, messages));
    renameSync(`${file}.tmp`, file);
  }
}

/** Hooks for a pane's --settings that deliver its inbox. The `mv` claims the
 * file, so two hooks firing together can't both deliver it. */
export function inboxHooks(groupId: string): Record<HookEvent, unknown[]> {
  const hook = (event: HookEvent) => {
    const file = quote(inboxFile(groupId, event));
    const other = quote(inboxFile(groupId, EVENTS.find((e) => e !== event)!));
    const claimed = quote(`${inboxFile(groupId, event)}.taken`);
    return {
      type: "command",
      command: `mv ${file} ${claimed} 2>/dev/null || exit 0; rm -f ${other}; cat ${claimed}; rm -f ${claimed}`,
    };
  };
  return {
    UserPromptSubmit: [{ hooks: [hook("UserPromptSubmit")] }],
    PostToolUse: [{ matcher: "", hooks: [hook("PostToolUse")] }],
  };
}

export function removeInbox(groupId: string): void {
  pending.delete(groupId);
  for (const event of EVENTS) rmSync(inboxFile(groupId, event), { force: true });
}
