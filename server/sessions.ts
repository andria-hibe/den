import * as pty from "node-pty";
import os from "node:os";
import { join } from "node:path";
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync,
} from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { COLORS } from "../shared/colors.ts";
import { HANDOVER_HEADINGS, HANDOVER_TEMPLATE, SESSION_NOTES_HEADING } from "../shared/handover.ts";
import { store, type SessionRow } from "./store.ts";
import { EMPTY_USAGE, addUsage, sessionUsage, type Usage } from "./usage.ts";
import { setupHint } from "./apprun.ts";
import { denRepo } from "./fs.ts";
import { hasSession, latestSessionForCwd } from "./discover.ts";
import { parseTicketHint } from "./github.ts";
import { logWarn } from "./log.ts";
import type { ServerMessage } from "./ws-protocol.ts";

const CLAUDE_BIN = process.env.MC_CLAUDE_BIN ?? "claude";

/** Current git branch of a directory, or null if not a repo / detached. */
function gitBranch(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out && out !== "HEAD" ? out : null;
  } catch {
    return null;
  }
}

const SCROLLBACK_CAP = 256 * 1024; // characters of terminal output kept per session

// Outside any repo, so a notepad never ends up in a commit.
const PROGRESS_DIR = join(os.homedir(), ".den", "progress");

// groupIds are randomUUIDs. Validate before building a path so a crafted id
// (e.g. "../../etc/foo") can't escape PROGRESS_DIR into arbitrary file read/write.
const GROUP_ID_RE = /^[A-Za-z0-9-]{1,64}$/;
export function isValidGroupId(groupId: string): boolean {
  return GROUP_ID_RE.test(groupId);
}
export const notepadPath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(PROGRESS_DIR, `${groupId}.md`);
};

// A review pane's diff, guide, and settings file; remove() deletes them.
const REVIEW_DIR = join(os.homedir(), ".den", "review");
const reviewDiffPath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(REVIEW_DIR, `${groupId}.diff`);
};
const reviewSettingsPath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(REVIEW_DIR, `${groupId}.settings.json`);
};
// Kept out of the notepad so the review's `## <path>` headings and the
// guide's `## <section title>` ones never share a parser.
export const reviewGuidePath = (groupId: string) => {
  if (!isValidGroupId(groupId)) throw new Error("bad_group_id");
  return join(REVIEW_DIR, `${groupId}.guide.md`);
};

/** The Claude permission rules for a PR-review pane. The deny list is a
 * backstop under reviewInstruction, which does the real work: a deny can't be
 * prompted past, but a shell can still reach the same place another way
 * (`git -C`, a wrapper script, an alias). `gh api` is denied because it can
 * POST anything.
 *
 * The allow list saves the review and guide without a prompt, plus the
 * read-only commands a review runs constantly: without them the code-review
 * skill stalls on a prompt for every `git show`. `git fetch` only moves local
 * refs. Deny beats allow, so none of this loosens the backstop.
 *
 * `notepadAbs` and `guideAbs` must be absolute; they're emitted as Claude's
 * "//<path>" root-anchored specifier. */
export function buildReviewPermissions(notepadAbs: string, guideAbs: string) {
  const root = (p: string) => "//" + p.replace(/^\/+/, "");
  return {
    permissions: {
      deny: [
        "Bash(git push:*)",
        "Bash(git commit:*)",
        "Bash(gh pr merge:*)",
        "Bash(gh pr review:*)",
        "Bash(gh pr comment:*)",
        "Bash(gh pr edit:*)",
        "Bash(gh pr close:*)",
        "Bash(gh pr reopen:*)",
        "Bash(gh pr ready:*)",
        "Bash(gh pr create:*)",
        "Bash(gh issue comment:*)",
        "Bash(gh api:*)",
      ],
      allow: [
        `Edit(${root(notepadAbs)})`,
        `Edit(${root(guideAbs)})`,
        "Bash(git log:*)",
        "Bash(git show:*)",
        "Bash(git diff:*)",
        "Bash(git status:*)",
        "Bash(git blame:*)",
        "Bash(git grep:*)",
        "Bash(git fetch:*)",
        "Bash(rg:*)",
        "Bash(grep:*)",
        "Bash(gh pr view:*)",
        "Bash(gh pr diff:*)",
        "Bash(gh pr checks:*)",
      ],
    },
  };
}

/** Where a review session must put any change it needs to make, so the PR's own
 * branch never carries den's edits. */
export function scratchBranch(branch: string | null | undefined): string {
  return `andria/changes-to-${branch || "this-pr"}`;
}

/** The system prompt for a workspace main pane's handover notepad (#27). It
 * says to read the notepad first because a restart doesn't re-inject the
 * initial prompt: the session notes are how a restarted pane picks up the
 * thread, and for a ticket the notepad is its only copy of the ticket. */
export function progressInstruction(file: string): string {
  const [stands, done, next, waiting] = HANDOVER_HEADINGS;
  return (
    `You're working in a project inside a tool called "den". Keep a handover ` +
    `at the absolute path ${file}. It has two readers: the developer, who ` +
    `wants to see where the work stands in one glance, and the next session ` +
    `that picks this work up (which may be you, after a restart, with no ` +
    `memory of this conversation). Read it before you start: its session notes ` +
    `are where you left off, and for a ticket it holds the ticket itself.\n` +
    `Rewrite it in place after each meaningful step (a decision, a finished ` +
    `task, a blocker, a change of plan). Do not append a log.\n` +
    `FOR THE DEVELOPER, keep these four sections at the top, under the title:\n` +
    `- "## ${stands}": one or two sentences on the goal and how far along it is.\n` +
    `- "## ${done}": what has changed for the user or the product, not how. ` +
    `Keep it to the few items that matter and fold older ones together.\n` +
    `- "## ${next}": the next step or two.\n` +
    `- "## ${waiting}": decisions or approvals the developer owes, or "Nothing."\n` +
    `Write those in plain language and short bullets. Leave out technical ` +
    `detail and bookkeeping there: no commit hashes, file paths, or command ` +
    `output, and no record of what you committed or pushed or which tests and ` +
    `checks you ran. Say what the work does, not how you got it there.\n` +
    `FOR THE NEXT SESSION, keep "## ${SESSION_NOTES_HEADING}" below them. Write ` +
    `it for yourself, not for the developer: everything you would need to carry ` +
    `on without re-deriving it. Put the technical detail here: the branch and ` +
    `its base, what is committed and pushed, what is half-done and where (files, ` +
    `functions), decisions and why they were made, what was tried and ruled ` +
    `out, gotchas, the state of tests and checks, and the exact next step. Keep ` +
    `it current rather than historical, but keep decisions and their reasons ` +
    `until they stop mattering.\n` +
    `Leave everything below the session notes (such as the ticket) as it is. If ` +
    `the file holds an older running log instead, fold it into this shape. The ` +
    `file is shown to the developer in a side notepad; don't mention it in your ` +
    `replies.`
  );
}

/** Rules for anything a session writes that leaves this machine, for every
 * pane that can commit or open a PR. The draft rule (#24) has no deny
 * backstop: permission patterns are prefix matches, so `Bash(gh pr create:*)`
 * can't say "only with --draft". */
export function houseRules(): string {
  return (
    `House rules for anything you write that leaves this machine (commit ` +
    `messages, PR titles and descriptions, GitHub comments and replies):\n` +
    `1. Write it in plain ASCII. Use "-" for a dash, "'" for an apostrophe, '"' ` +
    `for a quote, "->" for an arrow, and "..." for an ellipsis. Never write an ` +
    `em dash, an en dash, a curly quote, a real arrow, a non-breaking space, or ` +
    `an emoji.\n` +
    `2. Open every pull request as a draft: always pass --draft to ` +
    `\`gh pr create\`. Never run \`gh pr ready\` or mark a PR ready for review ` +
    `any other way. The developer decides when reviewers are notified.`
  );
}

let denSlugCache: string | null = null;
/** den's GitHub repo ("owner/name"), from its checkout's origin remote. */
export function denIssueRepo(): string {
  if (denSlugCache) return denSlugCache;
  let slug = "andria-hibe/den";
  try {
    const dir = denRepo();
    const url = dir
      ? execFileSync("git", ["-C", dir, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 3000 }).trim()
      : "";
    const m = url.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
    if (m) slug = m[1];
  } catch {
    // no checkout or no remote: keep the default
  }
  denSlugCache = slug;
  return slug;
}

/** Tells a session to file den's bugs and ideas as issues in den's repo.
 * That repo is public, so the rule keeps the work out of the issue. Every pane
 * kind gets it; for a review pane it's the one exception to never posting. */
export function denIssueRule(): string {
  const repo = denIssueRepo();
  return (
    `den itself: if you hit a bug or a rough edge in den (the tool this session ` +
    `runs in), or think of a way to improve it, file it as an issue with ` +
    `\`gh issue create --repo ${repo}\`. First check ` +
    `\`gh issue list --repo ${repo} --search "<words>"\` and don't file a ` +
    `duplicate. ${repo} is public: describe den's behaviour only, and keep out ` +
    `anything from the work you're doing (code, file names, branch, ticket, or ` +
    `PR names, people, company details). Write it in plain ASCII, then tell the ` +
    `developer you filed it, with the link. This is for den only, not for the ` +
    `project you're working in.`
  );
}

/** How a pane that changes code (workspace, my-PR) should treat tests. */
export function testingRules(): string {
  return (
    `Tests: add them only for important, core behaviour, the logic a ` +
    `regression would really hurt. Don't write low-value tests, and don't add ` +
    `one that another test in the suite already covers; look at the existing ` +
    `tests first. Don't add tests for fixes to your own mistakes or for ` +
    `changes made in response to review comments, unless the change has become ` +
    `a core part of how the feature works; be conservative about that. Every ` +
    `test costs time on ` +
    `every run and has to be maintained, so keep it simple: a few meaningful ` +
    `tests beat many small ones.`
  );
}

/** How a pane that changes code should comment it. The last rule overrides
 * Claude Code's own "match the surrounding comment density", which in a
 * heavily commented repo asks for more comments. */
export function commentRules(): string {
  return (
    `Comments: say why, and only what you know.\n` +
    `- A comment explains why the code is this way, not what it does. If the ` +
    `code or a well-chosen name already shows it, write nothing.\n` +
    `- Write only a reason you verified. If you can't point to the reason, ` +
    `write nothing, or only the part you verified. A plausible guess is worse ` +
    `than no comment: the next reader trusts it, and it outlives the code it ` +
    `describes.\n` +
    `- Write for a reader who never saw this conversation. Don't narrate the ` +
    `change or how you got there: no "now", "previously", "changed from", ` +
    `"fixed a bug where", "as requested", no notes to the reviewer, and no ` +
    `mention of your own mistakes. That belongs in the commit message or the ` +
    `PR.\n` +
    `- Stay on the code next to the comment. No asides and no open questions or ` +
    `TODOs; those go in a ticket. Don't restate a schema, type, or list that ` +
    `lives elsewhere; point to it once.\n` +
    `- One sentence by default. Write more only for something that breaks ` +
    `silently without it: an invariant the signature doesn't show, a pairing ` +
    `across files, or a workaround for an outside bug (link it).\n` +
    `- If your change makes a nearby comment false, fix that comment. Otherwise ` +
    `leave existing comments alone, and don't comment code you didn't change.\n` +
    `- Doc comments on exported API (JSDoc, YARD) and the reasons on lint ` +
    `suppressions are a separate thing and stay.\n` +
    `- These rules win over matching the surrounding code's comment density.`
  );
}

/** The system prompt for a Claude workspace's main pane. */
export function workspaceInstruction(notepad: string): string {
  return `${progressInstruction(notepad)}\n${houseRules()}\n${testingRules()}\n${commentRules()}\n${denIssueRule()}`;
}

/** The system prompt for a my-PR pane (#5). No notepad: the layout has
 * nowhere to show one, and the PR's commits are the record. No deny backstop
 * either, since this pane is meant to commit and push. */
export function myPrInstruction(
  pr: number | null,
  repo: string | null,
  branch: string | null,
): string {
  const which = `pull request${pr ? ` #${pr}` : ""}${repo ? ` (${repo})` : ""}`;
  const where = branch ? `, checked out on branch ${branch}` : "";
  return (
    `You're working on the developer's own ${which}${where}, inside a tool ` +
    `called "den". den shows the PR's description, reviews, and comments beside ` +
    `you, and the developer pastes individual comments into this session for ` +
    `you to action. For each one, make the change it asks for (or explain why ` +
    `not), run the checks that cover it, and say briefly what you changed. ` +
    `Commit and push only when the developer asks. If a reviewer needs a reply, ` +
    `write it here for the developer to post; don't post to GitHub yourself ` +
    `unless asked.\n${houseRules()}\n${testingRules()}\n${commentRules()}\n${denIssueRule()}`
  );
}

/** The system prompt for a look pane (#7). The ticket is saved to a file
 * rather than inlined, so a restart rebuilds the same prompt without den
 * needing the description again. */
export function lookInstruction(
  ticket: string | null,
  title: string,
  ticketFile: string,
): string {
  const which = ticket ? `${ticket}: ${title}` : title;
  return (
    `You're inside a tool called "den". The developer is reading the Linear ` +
    `ticket ${which} in a pane beside you, and will ask you about it. The ` +
    `ticket's description is saved at the absolute path ${ticketFile}; read it ` +
    `before you answer anything about the ticket. That file is for reference, ` +
    `so don't edit it.\n${houseRules()}\n${denIssueRule()}`
  );
}

/** The system prompt for a PR-review pane, and the primary guard against a
 * review changing the PR: the pane has a full shell, and
 * buildReviewPermissions is only the backstop.
 *
 * Keep it ASCII: the developer pastes the review into GitHub, and an
 * instruction full of em dashes teaches the model to write them back. Keep the
 * "just as thoroughly" clause: the bullet cap limits the writing, never the
 * reading. */
export function reviewInstruction(
  notepad: string,
  diffFile: string,
  branch: string | null | undefined,
  guideFile: string,
): string {
  const scratch = scratchBranch(branch);
  return (
    `You're reviewing a GitHub pull request inside a tool called "den". It's ` +
    `someone else's work and your job is to review it, not to change it. You have ` +
    `a full shell and can run anything you need to understand the change: the ` +
    `tests, a build, git history, gh reads. But these rules are absolute:\n` +
    `1. NEVER commit. Not on the PR's branch, not anywhere.\n` +
    `2. NEVER push, and never post anything to GitHub. No \`git push\`, no ` +
    `\`gh pr review\`/\`comment\`/\`merge\`/\`edit\`, no \`gh api\` writes. Your ` +
    `review goes in the notepad file named below and nowhere else; the developer ` +
    `decides what, if anything, reaches GitHub. The one exception is an issue ` +
    `about den itself, as described at the end.\n` +
    `3. If you need to change files, to test a fix, reproduce a bug, or check a ` +
    `suspicion, first move off the PR's branch: \`git checkout -b ${scratch}\` ` +
    `(or \`git checkout ${scratch}\` if it already exists), then edit there. Run ` +
    `it with no base argument while the PR's branch is checked out, so the ` +
    `scratch branch starts from the PR's code, not from master. Keep ` +
    `it local and uncommitted, and say so in your review rather than leaving it ` +
    `as a surprise. Never leave the PR's own branch modified.\n` +
    `The PR's full unified diff is saved at ${diffFile}; read that first, then ` +
    `read the changed files in your working directory for surrounding context. ` +
    `You have two deliverables: a reading guide and a review. Write the guide ` +
    `first when asked for both - it is quick and it orients the developer while ` +
    `the finding pass runs.\n` +
    `THE READING GUIDE goes in markdown at the absolute path ${guideFile} ` +
    `(create or overwrite it). It is how the developer reads the diff: it ` +
    `replaces file-alphabetical order with the order the change makes sense in. ` +
    `Structure it exactly like this: two or three lines saying what the PR does ` +
    `and how to read it, then one "## <section title>" heading per group of ` +
    `related changes, most important first - the core of the implementation, ` +
    `then the supporting changes, then low-signal churn (generated files, ` +
    `lockfiles, formatting, fixtures) last. Under each heading write two to ` +
    `four lines on what that group does and what its impact or risk is, then a ` +
    `line "Files: path/one.ts, path/two.ts" naming every file in the group, ` +
    `each path exactly as it appears after "b/" in the diff's "diff --git" ` +
    `line. Put every changed file in exactly one section, and put no other ` +
    `heading in the file. den renders each section's prose above that section's ` +
    `own diffs. The guide orients, it does not review: no findings there, they ` +
    `go in the review below.\n` +
    `Start the finding pass by running Claude Code's built-in code-review skill ` +
    `at high effort against this PR's ` +
    (branch ? `branch (${branch})` : `checked-out branch`) +
    `; it hunts correctness bugs and verifies its findings before reporting. ` +
    `Never pass --comment (posts to GitHub) or --fix (edits the working tree). ` +
    `Its report renders in the terminal only and is not the deliverable: fold ` +
    `the verified findings into the notepad review described next, and cover ` +
    `yourself what its scope misses (design, tests, naming, missing cases). If ` +
    `the skill is unavailable, do the whole review by hand.\n` +
    `THE REVIEW goes as markdown at the absolute path ${notepad} ` +
    `(create or overwrite it). That file is where the review lives. den splits ` +
    `that file up and renders each file's comments next to that file's diff, so ` +
    `structure it exactly like this: first the general review (a two or three ` +
    `line summary, then any cross-cutting risk), then one "## <file path>" ` +
    `heading per file you have comments on, the path exactly as it appears after ` +
    `"b/" in the diff's "diff --git" line, followed by that file's comments as ` +
    `bullets. Put nothing but that file's comments under its heading, and skip ` +
    `files you have nothing to say about.\n` +
    `WRITE THE WHOLE REVIEW IN PLAIN ASCII. The developer copies these comments ` +
    `straight into GitHub, so every character must survive a copy-paste. Use "-" ` +
    `for a dash, "'" for an apostrophe, '"' for a quote, "->" for an arrow, and ` +
    `"..." for an ellipsis. Never write an em dash, an en dash, a curly quote, a ` +
    `curly apostrophe, a real arrow, a non-breaking space, box drawing, or an ` +
    `emoji. If a line you quote from the diff already holds a non-ASCII ` +
    `character, keep it inside a code span, but never add one of your own. The ` +
    `guide obeys the same rule.\n` +
    `KEEP THE WRITING SHORT AND DIRECT WHILE DOING THE REVIEW JUST AS ` +
    `THOROUGHLY. Read as widely as the change needs; it is the prose that is ` +
    `terse, never the work behind it. Lead with the result and skip preamble ` +
    `and narration. One issue per bullet, one or two sentences. Open the bullet ` +
    `with "path:line" (or "path:start-end"), then the problem, then the fix. Say ` +
    `what to change, not how you feel about it. Give each file at most 5 ` +
    `bullets, worst first; if a file has more, keep the top 5 and add one bullet ` +
    `naming what you left out. No praise, no preamble, no closing recap, no ` +
    `hedging adverbs. A file you are happy with gets no heading at all.\n` +
    `Write the clean, finished review there, not a running log; don't mention ` +
    `these files in your replies. If you are asked for only one of the two ` +
    `deliverables, write only that file and leave the other alone. Once they ` +
    `are written, answer follow-up questions (about one file, one comment, or ` +
    `anything else) in the terminal and leave both files as they are, unless ` +
    `the developer asks you to change them.\n` +
    denIssueRule()
  );
}

/** Re-exported for the tests. */
export { isAscii } from "../shared/ascii.ts";

/**
 * Which conversation a restarting Claude pane reopens:
 * 1. its pinned session, if that transcript exists -> resume it;
 * 2. a pinned id with no transcript -> start fresh under the same id. Claude
 *    Code writes no transcript until the first message, so this is any pane
 *    restarted before anyone typed in it. Never borrow another conversation:
 *    look panes share the work repo's main checkout, so "newest in this cwd"
 *    is often another ticket's session (#25);
 * 3. no pinned id (an old row) -> the newest conversation in this cwd;
 * 4. else a fresh session under a new id.
 */
export function chooseResume(
  pinnedId: string | null,
  hasTranscript: (id: string) => boolean,
  latestForCwd: () => string | null,
): { resume: boolean; id: string } {
  if (pinnedId) return { resume: hasTranscript(pinnedId), id: pinnedId };
  const latest = latestForCwd();
  if (latest) return { resume: true, id: latest };
  return { resume: false, id: randomUUID() };
}

/** How long a workspace pane sits with no output before den refreshes its
 * handover (#23), unless overridden (see idleHandoverMs). */
export const IDLE_HANDOVER_MS = 30 * 60_000;

/** The idle window in ms; 0 means off. */
function idleHandoverMs(): number {
  for (const raw of [process.env.DEN_IDLE_HANDOVER_MIN, store.getSetting("idle_handover_min")]) {
    if (raw == null || raw === "") continue;
    if (raw.trim().toLowerCase() === "off") return 0;
    const min = Number(raw);
    if (Number.isFinite(min) && min >= 0) return min * 60_000;
  }
  return IDLE_HANDOVER_MS;
}

/** A notepad written this close to the end of a burst of work is taken as
 * current: sessions update it at the end of a step, then print their reply. */
export const NOTEPAD_FRESH_MS = 2 * 60_000;

/** Is an idle handover due? Only after input since the last one (else an
 * untouched pane gets one every idle period), `idleMs` without output, and no
 * notepad write near the end of that output. */
export function idleHandoverDue(p: {
  now: number;
  idleMs: number;
  lastOutputAt: number;
  lastInputAt: number;
  lastHandoverAt: number;
  notepadMtime: number;
}): boolean {
  if (p.idleMs <= 0) return false;
  if (p.lastInputAt <= p.lastHandoverAt) return false;
  if (!p.lastOutputAt || p.now - p.lastOutputAt < p.idleMs) return false;
  return p.notepadMtime < p.lastOutputAt - NOTEPAD_FRESH_MS;
}

/** The spend in `claude -p --output-format json` output, or null without a
 * `total_cost_usd`. */
export function forkUsage(stdout: string): Usage | null {
  try {
    const o = JSON.parse(stdout) as {
      total_cost_usd?: number;
      usage?: {
        input_tokens?: number; output_tokens?: number;
        cache_read_input_tokens?: number; cache_creation_input_tokens?: number;
      };
    };
    if (typeof o.total_cost_usd !== "number") return null;
    return {
      costUSD: o.total_cost_usd,
      input: o.usage?.input_tokens ?? 0,
      output: o.usage?.output_tokens ?? 0,
      cacheRead: o.usage?.cache_read_input_tokens ?? 0,
      cacheWrite: o.usage?.cache_creation_input_tokens ?? 0,
      unpriced: false,
    };
  } catch {
    return null;
  }
}

/** What the idle handover asks. It runs in a headless fork of the pane's
 * conversation (see SessionManager.runIdleHandover), never in the live pane:
 * a pane waiting at a permission prompt looks exactly as idle as a finished
 * one, and typing into it would answer the prompt, or send a draft the
 * developer left in the input box. */
export function idleHandoverPrompt(notepad: string): string {
  return (
    `den: this session has gone quiet. Bring your handover at ${notepad} up to ` +
    `date with where the work stands right now, following the handover rules in ` +
    `your instructions: rewrite the developer's four sections and the session ` +
    `notes in place, and leave everything else in the file alone. If you were ` +
    `waiting on the developer (a question, a permission prompt, a decision), say ` +
    `so under "Waiting on you". Do not run anything or change any other file. ` +
    `Reply with one word: done.`
  );
}

/**
 * Does a PTY look ready for scripted input: some output, then `idleMs` of
 * quiet? Claude's TUI drops input that arrives while it's starting up
 * (measured: a paste 6s after spawn vanished, the same paste at 12s landed),
 * so anything den sends on its own waits for this rather than a fixed delay.
 * No output yet means still booting, not idle.
 */
export function ptyLooksIdle(
  lastOutputAt: number,
  now: number,
  idleMs: number,
): boolean {
  if (!lastOutputAt) return false;
  return now - lastOutputAt >= idleMs;
}

/**
 * New `pos` for every session given the rail's workspace order.
 *
 * Groups named in `groupIds` take those slots in that order; any group the
 * client didn't name (e.g. a workspace created between the drag and the request)
 * keeps its relative order after them, ranked by its current `pos`. Panes of one
 * workspace all get the same number — `list()` breaks the tie by `createdAt`.
 */
export function reorderPositions(
  sessions: { id: string; groupId: string; pos: number }[],
  groupIds: string[],
): Map<string, number> {
  const rank = new Map<string, number>();
  groupIds.forEach((g, i) => rank.set(g, i));
  const unlisted = [...new Set(sessions.map((s) => s.groupId))]
    .filter((g) => !rank.has(g))
    .sort(
      (a, b) =>
        Math.min(...sessions.filter((s) => s.groupId === a).map((s) => s.pos)) -
        Math.min(...sessions.filter((s) => s.groupId === b).map((s) => s.pos)),
    );
  unlisted.forEach((g, i) => rank.set(g, groupIds.length + i));
  return new Map(sessions.map((s) => [s.id, rank.get(s.groupId) ?? 0]));
}

/** Metadata shape sent to the web app. */
export interface SessionMeta {
  id: string;
  name: string;
  color: string;
  cwd: string;
  shell: boolean;
  status: "running" | "exited";
  pid: number | null;
  createdAt: number;
  lastActive: number;
  /** A Claude workspace is one "main" pane plus its "shell" tabs. */
  groupId: string;
  role: "main" | "shell";
  /** Git branch of the working dir (captured at start), and its ticket hint. */
  branch: string | null;
  ticketHint: string | null;
  /** The session rang the bell while unwatched — it wants your attention. */
  attention: boolean;
  /** Linear ticket this workspace is for (identifier, e.g. "FAST-6115"). */
  ticket: string | null;
  /** A lightweight "just looking" session: ticket viewer + one Claude pane. */
  look: boolean;
  /** Special GitHub PR layout: "review" (others' PR) or "mypr" (your own). */
  view: "review" | "mypr" | null;
  /** The GitHub PR this session is for (number + nameWithOwner repo). */
  pr: number | null;
  prRepo: string | null;
  /** Rail sort key (see `reorder`). The list arrives already sorted by it. */
  pos: number;
  /** Keeps a handover: the notepad instruction and the idle refresh (#11). */
  handover: boolean;
}

type Listener = (msg: ServerMessage) => void;

/** Named, because nine positional arguments invite silent transpositions. */
interface SessionInit {
  id: string;
  name: string;
  color: string;
  cwd: string;
  shell: boolean;
  createdAt: number;
  lastActive: number;
  groupId: string;
  role: "main" | "shell";
  /** Rail sort key; defaults to `createdAt` (i.e. creation order). */
  pos?: number;
}

/**
 * One session = one long-lived PTY (Claude Code by default) that outlives any
 * particular WebSocket. It buffers recent output so a (re)attaching client can
 * replay scrollback instantly.
 */
class DenSession {
  term: pty.IPty | null = null;
  status: "running" | "exited" = "running";
  private buffer: string[] = [];
  private bufferBytes = 0;
  /** When the PTY last emitted output; 0 = nothing yet. Drives `waitUntilIdle`
   * and the idle handover. */
  lastOutputAt = 0;
  /** When anything was typed or pasted into the PTY; 0 = never. The idle
   * handover only fires after input since the last one, so a pane nobody has
   * touched doesn't get a handover every half hour. */
  lastInputAt = 0;
  /** When den last ran an idle handover for this pane, and whether one is
   * running now. */
  lastHandoverAt = 0;
  handoverRunning = false;
  /** Keep a handover (the notepad instruction and the idle refresh). */
  handover = true;
  /** What den's idle handovers for this pane have spent. They run as headless
   * forks that save no transcript, so their usage is tracked here instead
   * (in memory: it resets when den restarts). */
  handoverUsage: Usage = { ...EMPTY_USAGE };
  /** New output since the last scrollback flush to the store. */
  private scrollbackDirty = false;
  private listeners = new Set<Listener>();
  /** Once the user renames, stop auto-updating the title from the terminal. */
  titleLocked = false;
  private oscCarry = "";
  /** Set when the terminal rings the bell while unwatched (Claude wants input). */
  attention = false;

  /** Claude's args; null means the default (a login shell, or `claude -n <name>`). */
  spawnArgs: string[] | null = null;
  /** The Claude conversation id this pane owns (pinned via `--session-id` at
   * spawn), so a restart can `--resume` the *same* conversation rather than
   * starting a blank one. Null for shells and pre-existing rows. */
  claudeSessionId: string | null = null;
  /** Git branch of the working dir, captured when the session starts. */
  branch: string | null = null;
  /** Linear ticket identifier this workspace is for, if any. */
  ticket: string | null = null;
  /** Whether this is a lightweight "just looking" session. */
  look = false;
  /** GitHub PR view mode + which PR, if this is a PR session. */
  view: "review" | "mypr" | null = null;
  pr: number | null = null;
  prRepo: string | null = null;

  id: string;
  name: string;
  color: string;
  cwd: string;
  shell: boolean;
  createdAt: number;
  lastActive: number;
  groupId: string;
  role: "main" | "shell";
  /** Where this session's workspace sits in the rail — see SessionManager.reorder. */
  pos: number;

  constructor(init: SessionInit) {
    this.id = init.id;
    this.name = init.name;
    this.color = init.color;
    this.cwd = init.cwd;
    this.shell = init.shell;
    this.createdAt = init.createdAt;
    this.lastActive = init.lastActive;
    this.groupId = init.groupId;
    this.role = init.role;
    this.pos = init.pos ?? init.createdAt;
  }

  spawn() {
    const loginShell = process.env.SHELL ?? "/bin/zsh";
    const file = this.shell ? loginShell : CLAUDE_BIN;
    const args = this.spawnArgs ?? (this.shell ? [] : ["-n", this.name]);
    let term: pty.IPty;
    try {
      term = pty.spawn(file, args, {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: this.cwd || os.homedir(),
        env: { ...process.env, TERM: "xterm-256color" },
      });
    } catch (err) {
      // A missing binary or a bad cwd: show the pane as exited rather than
      // failing the create request.
      logWarn(`pty.spawn ${file}`, err);
      this.status = "exited";
      this.term = null;
      this.emit({ type: "exit", code: null });
      return;
    }
    this.term = term;
    this.status = "running";
    term.onData((data) => this.push(data));
    term.onExit(({ exitCode, signal }) => {
      this.status = "exited";
      this.term = null;
      this.persistScrollback(); // keep the final output across a restart
      this.emit({ type: "exit", code: exitCode, signal });
    });
  }

  private push(data: string) {
    this.buffer.push(data);
    this.bufferBytes += data.length;
    this.lastOutputAt = Date.now();
    this.scrollbackDirty = true;
    while (this.bufferBytes > SCROLLBACK_CAP && this.buffer.length > 1) {
      this.bufferBytes -= this.buffer.shift()!.length;
    }
    if (this.listeners.size === 0 && data.includes("\u0007")) {
      this.attention = true;
    }
    this.maybeTitle(data);
    this.emit({ type: "output", data });
  }

  /** Use the latest OSC title (ESC ] 0|1|2 ; <title> BEL or ST) as the session
   * name. Claude panes only: shells retitle to the cwd/command on every
   * prompt, which flaps. */
  private maybeTitle(chunk: string) {
    if (this.shell || this.titleLocked) return;
    const data = this.oscCarry + chunk;
    const re = /\x1b\][012];([^\x07\x1b]*)(?:\x07|\x1b\\)/g;
    let m: RegExpExecArray | null;
    let latest: string | null = null;
    while ((m = re.exec(data))) latest = m[1];

    // Carry a trailing, not-yet-terminated OSC across chunk boundaries.
    const open = data.lastIndexOf("\x1b]");
    this.oscCarry =
      open !== -1 && !/[\x07]|\x1b\\/.test(data.slice(open))
        ? data.slice(open).slice(-512)
        : "";

    if (latest === null) return;
    const title = latest.trim().replace(/\s+/g, " ").slice(0, 60);
    if (title && title !== this.name) {
      this.name = title;
      this.lastActive = Date.now();
      store.update(this.toRow());
      this.emit({ type: "title", name: title });
    }
  }

  lockTitle() {
    this.titleLocked = true;
  }

  private emit(msg: ServerMessage) {
    for (const l of this.listeners) l(msg);
  }

  /** Register a client; synchronously returns the scrollback to replay first. */
  attach(listener: Listener): { scrollback: string; detach: () => void } {
    this.attention = false; // viewing it clears the nudge
    const scrollback = this.buffer.join("");
    this.listeners.add(listener);
    return {
      scrollback,
      detach: () => this.listeners.delete(listener),
    };
  }

  write(data: string) {
    this.term?.write(data);
    this.lastActive = Date.now();
    this.lastInputAt = this.lastActive;
  }

  /**
   * Wait until the PTY looks ready for scripted input (see `ptyLooksIdle`), so a
   * paste den sends itself isn't swallowed by a TUI that's still drawing. Returns
   * whether it settled; on timeout the caller can still go ahead (a lost paste is
   * no worse than not trying).
   */
  async waitUntilIdle(idleMs = 800, timeoutMs = 30_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.status === "exited") return false;
      if (ptyLooksIdle(this.lastOutputAt, Date.now(), idleMs)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  }

  resize(cols: number, rows: number) {
    if (!this.term) return;
    this.term.resize(
      Math.max(1, Math.floor(cols) || 80),
      Math.max(1, Math.floor(rows) || 24),
    );
  }

  kill() {
    try {
      this.term?.kill();
    } catch {
      // already dead
    }
  }

  meta(): SessionMeta {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      cwd: this.cwd,
      shell: this.shell,
      status: this.status,
      pid: this.term?.pid ?? null,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
      groupId: this.groupId,
      role: this.role,
      branch: this.branch,
      ticketHint: parseTicketHint(this.branch) ?? null,
      attention: this.attention,
      ticket: this.ticket,
      look: this.look,
      view: this.view,
      pr: this.pr,
      prRepo: this.prRepo,
      pos: this.pos,
      handover: this.handover,
    };
  }

  toRow(): SessionRow {
    return {
      id: this.id,
      name: this.name,
      color: this.color,
      cwd: this.cwd,
      shell: this.shell ? 1 : 0,
      claudeSessionId: this.claudeSessionId,
      status: this.status,
      createdAt: this.createdAt,
      lastActive: this.lastActive,
      groupId: this.groupId,
      role: this.role,
      branch: this.branch,
      ticket: this.ticket,
      look: this.look ? 1 : 0,
      view: this.view,
      pr: this.pr,
      prRepo: this.prRepo,
      titleLocked: this.titleLocked ? 1 : 0,
      // Scrollback is persisted separately (store.setScrollback), not on this
      // metadata path — a fresh row starts empty.
      scrollback: null,
      pos: this.pos,
      handover: this.handover ? 1 : 0,
    };
  }

  /** Restore persisted scrollback so an attaching client replays it after a
   * server restart (the live PTY is gone, but its output history survives). */
  restoreScrollback(text: string) {
    this.buffer = [text];
    this.bufferBytes = text.length;
  }

  /** Drop the scrollback; a restarted process starts fresh. */
  clearBuffer() {
    this.buffer = [];
    this.bufferBytes = 0;
    this.scrollbackDirty = true;
  }

  /** Write the current scrollback to the store if it changed since last flush. */
  persistScrollback() {
    if (!this.scrollbackDirty) return;
    this.scrollbackDirty = false;
    store.setScrollback(this.id, this.buffer.join(""));
  }
}

// How often to flush changed scrollback to the store. A crash loses at most
// this much recent output; keeping it coarse avoids constant disk writes.
const SCROLLBACK_FLUSH_MS = 5000;

class SessionManager {
  private sessions = new Map<string, DenSession>();
  private colorIdx = 0;

  constructor() {
    const timer = setInterval(() => {
      for (const s of this.sessions.values()) s.persistScrollback();
    }, SCROLLBACK_FLUSH_MS);
    // Don't keep the process alive just for this (CLI/tests exit cleanly).
    timer.unref?.();
    // Faster than once a minute only when the window is set very short.
    const idleMs = idleHandoverMs();
    if (idleMs > 0) {
      const idleTimer = setInterval(() => this.checkIdleHandovers(), Math.min(60_000, idleMs / 2));
      idleTimer.unref?.();
    }
  }

  /** Start an idle handover for every workspace main pane that is due one. */
  private checkIdleHandovers() {
    const idleMs = idleHandoverMs();
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (s.shell || s.role !== "main" || s.look || s.view) continue;
      if (s.status !== "running" || !s.handover || s.handoverRunning || !s.claudeSessionId) continue;
      let notepadMtime = 0;
      try {
        notepadMtime = statSync(notepadPath(s.groupId)).mtimeMs;
      } catch {
        // no notepad yet: nothing is current, so a handover is worth writing
      }
      const due = idleHandoverDue({
        now, idleMs, notepadMtime,
        lastOutputAt: s.lastOutputAt, lastInputAt: s.lastInputAt, lastHandoverAt: s.lastHandoverAt,
      });
      if (due) this.runIdleHandover(s);
    }
  }

  /**
   * Refresh a pane's handover from a headless fork of its conversation:
   * `claude -p --resume <id> --fork-session --no-session-persistence` reads the
   * whole conversation, writes the notepad, and exits without saving the fork,
   * so the live pane, its transcript, and the resume list are all untouched.
   * It may only read and edit the notepad. Fire-and-forget; a failure is
   * logged and the pane is left as it was.
   */
  private runIdleHandover(s: DenSession) {
    const id = s.claudeSessionId;
    if (!id || !hasSession(id)) return; // nothing said in the pane yet
    const notepad = notepadPath(s.groupId);
    s.handoverRunning = true;
    s.lastHandoverAt = Date.now();
    execFile(
      "claude",
      [
        "-p",
        "--resume", id,
        "--fork-session",
        "--no-session-persistence",
        "--add-dir", PROGRESS_DIR,
        "--allowedTools", "Read", `Edit(//${notepad.replace(/^\/+/, "")})`,
        "--append-system-prompt", progressInstruction(notepad),
        "--output-format", "json",
        "--", idleHandoverPrompt(notepad),
      ],
      { cwd: s.cwd, timeout: 10 * 60_000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        s.handoverRunning = false;
        if (err) logWarn("idleHandover", err);
        // The fork saves no transcript, so its spend is only in this result.
        const spent = forkUsage(stdout);
        if (spent) s.handoverUsage = addUsage(s.handoverUsage, spent);
      },
    );
  }

  /** Restore persisted rows as exited placeholders (live PTYs don't survive). */
  hydrate() {
    store.markAllExited();
    for (const row of store.all()) {
      const s = new DenSession({
        id: row.id,
        name: row.name,
        color: row.color,
        cwd: row.cwd,
        shell: row.shell === 1,
        createdAt: row.createdAt,
        lastActive: row.lastActive,
        groupId: row.groupId ?? row.id,
        role: (row.role as "main" | "shell") ?? "main",
        pos: row.pos ?? row.createdAt,
      });
      s.status = "exited";
      s.claudeSessionId = row.claudeSessionId ?? null;
      s.branch = row.branch ?? null;
      s.ticket = row.ticket ?? null;
      s.look = row.look === 1;
      s.view = (row.view as "review" | "mypr" | null) ?? null;
      s.pr = row.pr ?? null;
      s.prRepo = row.prRepo ?? null;
      s.titleLocked = row.titleLocked === 1;
      s.handover = row.handover !== 0;
      if (row.scrollback) s.restoreScrollback(row.scrollback);
      this.sessions.set(s.id, s);
    }
  }

  private resolveCwd(cwd?: string) {
    const documents = join(os.homedir(), "Documents");
    return cwd || (existsSync(documents) ? documents : os.homedir());
  }

  private spawnSession(s: DenSession) {
    s.spawn();
    this.sessions.set(s.id, s);
    store.insert(s.toRow());
  }

  /**
   * Create a workspace and return its "main" session.
   * - shell: a single plain terminal (main pane only).
   * - claude: a main Claude pane + a sibling shell pane in the same folder, plus
   *   a progress notepad the main Claude is told to keep.
   */
  create(opts: {
    name?: string;
    color?: string;
    cwd?: string;
    shell?: boolean;
    resumeId?: string;
    ticket?: string;
    look?: boolean;
    notepadSeed?: string;
    view?: "review" | "mypr";
    pr?: number;
    prRepo?: string;
    initialPrompt?: string;
    /** The PR's unified diff, for a review pane's read-only diff file. */
    reviewDiff?: string;
  }) {
    const now = Date.now();
    const shell = opts.shell ?? false;
    const color = opts.color ?? COLORS[this.colorIdx++ % COLORS.length];
    const cwd = this.resolveCwd(opts.cwd);
    const groupId = randomUUID();
    const branch = gitBranch(cwd);

    if (shell) {
      const name = opts.name ?? "shell";
      const s = new DenSession({
        id: groupId, name, color, cwd, shell: true,
        createdAt: now, lastActive: now, groupId, role: "main",
      });
      s.branch = branch;
      this.spawnSession(s);
      return s.meta();
    }

    // Single-pane Claude sessions: a ticket look, a PR review, or a my-PR view.
    if (opts.look || opts.view) {
      const name =
        opts.name ?? opts.ticket ?? (opts.pr ? `PR #${opts.pr}` : "look");
      const s = new DenSession({
        id: groupId, name, color, cwd, shell: false,
        createdAt: now, lastActive: now, groupId, role: "main",
      });
      s.claudeSessionId = randomUUID();
      s.branch = branch;
      s.ticket = opts.ticket ?? null;
      s.look = !!opts.look;
      s.view = opts.view ?? null;
      s.pr = opts.pr ?? null;
      s.prRepo = opts.prRepo ?? null;
      s.spawnArgs = [
        "--session-id", s.claudeSessionId, "-n", name,
        ...this.singlePaneArgs(s, { diff: opts.reviewDiff, seed: opts.notepadSeed }),
      ];
      // Keep the ticket/PR title rather than Claude's.
      if (opts.ticket || opts.pr) s.titleLocked = true;
      this.spawnSession(s);
      return s.meta();
    }

    const name = opts.name ?? `den-${this.sessions.size + 1}`;
    this.ensureNotepad(groupId, opts.notepadSeed);

    const main = new DenSession({
      id: randomUUID(), name, color, cwd, shell: false,
      createdAt: now, lastActive: now, groupId, role: "main",
    });
    // Pin the conversation id (or adopt the one we're resuming) so a later
    // restart can bring back THIS exact conversation.
    main.claudeSessionId = opts.resumeId ?? randomUUID();
    main.spawnArgs = [
      ...(opts.resumeId
        ? ["--resume", opts.resumeId]
        : ["--session-id", main.claudeSessionId, "-n", name]),
      ...this.workspaceArgs(groupId, cwd),
      // `--` so a prompt starting with "-" is read as the prompt, never a flag.
      ...(opts.initialPrompt && !opts.resumeId ? ["--", opts.initialPrompt] : []),
    ];
    main.branch = branch;
    main.ticket = opts.ticket ?? null;
    // Keep the ticket title rather than Claude's.
    if (opts.ticket) main.titleLocked = true;
    this.spawnSession(main);

    const term = new DenSession({
      id: randomUUID(), name: "terminal", color, cwd, shell: true,
      createdAt: now, lastActive: now, groupId, role: "shell",
    });
    term.branch = branch;
    this.spawnSession(term);

    return main.meta();
  }

  /**
   * Add another shell pane to an existing workspace (a new "shell" tab). The
   * new terminal inherits the group's cwd / colour / branch. Returns its meta,
   * or null if the group has no sessions.
   */
  addShell(groupId: string): SessionMeta | null {
    const sibling = [...this.sessions.values()].find(
      (s) => s.groupId === groupId,
    );
    if (!sibling) return null;
    const now = Date.now();
    const term = new DenSession({
      id: randomUUID(), name: "terminal", color: sibling.color,
      cwd: sibling.cwd, shell: true, createdAt: now, lastActive: now,
      groupId, role: "shell",
    });
    term.branch = sibling.branch;
    this.spawnSession(term);
    return term.meta();
  }

  /** Re-spawn an exited session's PTY in place, keeping its identity and
   * context. Args are rebuilt rather than reused, so a restart never re-sends
   * a one-time initial prompt. Null if unknown or already running. */
  restart(id: string): SessionMeta | null {
    const s = this.sessions.get(id);
    if (!s || s.status === "running") return null;
    s.spawnArgs = s.shell ? null : this.restartArgs(s);
    s.clearBuffer();
    s.spawn();
    store.update(s.toRow());
    return s.meta();
  }

  /** Claude spawn args for a restart, rebuilt from the session's context by
   * the same builders create() uses, so a revived pane gets exactly the system
   * prompt a fresh one would. */
  private restartArgs(s: DenSession): string[] {
    const resume = this.resumeArgs(s);
    if (s.role === "main" && !s.look && !s.view) {
      return [...resume, ...this.workspaceArgs(s.groupId, s.cwd, s.handover)];
    }
    return [...resume, ...this.singlePaneArgs(s)];
  }

  /** The notepad wiring and system prompt for a workspace main pane, shared by
   * create() and restartArgs(). The notepad itself is created (and seeded) by
   * create(); a restart keeps whatever is in it. */
  private workspaceArgs(groupId: string, cwd: string, handover = true): string[] {
    mkdirSync(PROGRESS_DIR, { recursive: true });
    // With the handover off, the pane still gets the house rules, just not
    // the notepad instruction (the notepad stays for the developer's own use).
    const base = handover
      ? workspaceInstruction(notepadPath(groupId))
      : `${houseRules()}\n${testingRules()}\n${commentRules()}\n${denIssueRule()}`;
    const hint = setupHint(cwd);
    const prompt = hint ? `${base}\n${hint}` : base;
    return ["--add-dir", PROGRESS_DIR, "--append-system-prompt", prompt];
  }

  /** The system prompt (and any files it names) for a single-pane Claude
   * session, shared by create() and restartArgs(). `diff` and `seed` come only
   * from create; a restart keeps what was saved before. */
  private singlePaneArgs(
    s: DenSession,
    from: { diff?: string; seed?: string } = {},
  ): string[] {
    if (s.view === "review") return this.reviewArgs(s.groupId, s.branch, from.diff);
    if (s.view === "mypr") {
      return ["--append-system-prompt", myPrInstruction(s.pr, s.prRepo, s.branch)];
    }
    if (s.look) {
      // A look pane from before den saved the ticket has no seed: say so in the
      // file rather than leave the session hunting for a description.
      const fallback =
        `# ${s.ticket ?? s.name}\n\nden did not save this ticket's description. ` +
        `Ask the developer to paste it.\n`;
      const file = this.ensureNotepad(s.groupId, from.seed ?? fallback);
      return [
        "--add-dir", PROGRESS_DIR,
        "--append-system-prompt", lookInstruction(s.ticket, s.name, file),
      ];
    }
    return [];
  }

  /** A review pane's settings file, files, and system prompt. Pass `diff` on
   * create; a restart omits it and keeps the captured diff. `--permission-mode
   * default` keeps the settings file's deny rules in force. */
  private reviewArgs(groupId: string, branch: string | null, diff?: string): string[] {
    const file = this.ensureNotepad(groupId, "");
    const diffFile = this.ensureReviewDiff(groupId, diff);
    const guideFile = this.ensureReviewGuide(groupId);
    const settingsFile = this.ensureReviewPerms(groupId);
    return [
      "--settings", settingsFile,
      "--permission-mode", "default",
      "--add-dir", PROGRESS_DIR,
      "--add-dir", REVIEW_DIR,
      "--append-system-prompt", reviewInstruction(file, diffFile, branch, guideFile),
    ];
  }

  /** The `claude` args that reopen (or restart) a pane's conversation; see
   * chooseResume for the rules. Adopts whatever id it settles on, so the next
   * restart of this pane is unambiguous. */
  private resumeArgs(s: DenSession): string[] {
    const pick = chooseResume(s.claudeSessionId, hasSession, () => latestSessionForCwd(s.cwd));
    s.claudeSessionId = pick.id;
    return pick.resume
      ? ["--resume", pick.id]
      : ["--session-id", pick.id, "-n", s.name];
  }

  /** What a Claude pane has spent: its conversation (from the transcript)
   * plus den's idle handovers for it. Null for a shell or an unknown id. */
  usage(id: string): { conversation: Usage; handovers: Usage; total: Usage } | null {
    const s = this.sessions.get(id);
    if (!s || s.shell) return null;
    const conversation = s.claudeSessionId ? sessionUsage(s.claudeSessionId) : { ...EMPTY_USAGE };
    return { conversation, handovers: s.handoverUsage, total: addUsage(conversation, s.handoverUsage) };
  }

  /** Turn a workspace's handover on or off. The idle refresh follows at once;
   * the notepad instruction is part of the system prompt, so it follows from
   * the pane's next start. */
  setHandover(id: string, on: boolean): SessionMeta | null {
    const s = this.sessions.get(id);
    if (!s || s.shell || s.role !== "main" || s.look || s.view) return null;
    s.handover = on;
    store.update(s.toRow());
    return s.meta();
  }

  get(id: string) {
    return this.sessions.get(id);
  }

  list(): SessionMeta[] {
    // Sorted here (not just in the store) so a session created since the last
    // hydrate lands in the right place without a round-trip through sqlite.
    return [...this.sessions.values()]
      .sort((a, b) => a.pos - b.pos || a.createdAt - b.createdAt)
      .map((s) => s.meta());
  }

  /**
   * Reorder the rail: `groupIds` is the workspace order the user dragged into
   * place. Every pane of a workspace shares its workspace's position, so shell
   * tabs travel with their main pane and keep their own creation order within it.
   */
  reorder(groupIds: string[]): SessionMeta[] {
    const positions = reorderPositions([...this.sessions.values()], groupIds);
    for (const s of this.sessions.values()) {
      const pos = positions.get(s.id);
      if (pos === undefined || pos === s.pos) continue;
      s.pos = pos;
      store.update(s.toRow());
    }
    return this.list();
  }

  update(id: string, patch: { name?: string; color?: string }) {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (patch.name !== undefined) {
      s.name = patch.name;
      s.lockTitle(); // manual rename wins over terminal-set titles
    }
    // Recolour the whole workspace so panes stay visually grouped.
    if (patch.color !== undefined) {
      for (const other of this.sessions.values()) {
        if (other.groupId === s.groupId) {
          other.color = patch.color;
          store.update(other.toRow());
        }
      }
    }
    s.lastActive = Date.now();
    store.update(s.toRow());
    return s.meta();
  }

  /**
   * Remove a single session (one shell tab), leaving the rest of its workspace
   * intact. Refuses to remove a "main" pane — closing that means closing the
   * whole workspace (use remove()). Returns false if not found / not allowed.
   */
  removeOne(id: string) {
    const s = this.sessions.get(id);
    if (!s || s.role !== "shell") return false;
    s.kill();
    this.sessions.delete(id);
    store.delete(id);
    return true;
  }

  /** Remove the whole workspace the given session belongs to. */
  remove(id: string) {
    const s = this.sessions.get(id);
    if (!s) return false;
    const groupId = s.groupId;
    for (const other of [...this.sessions.values()]) {
      if (other.groupId === groupId) {
        other.kill();
        this.sessions.delete(other.id);
        store.delete(other.id);
      }
    }
    // Closing the workspace deletes its files; exit and restart keep them.
    try {
      rmSync(notepadPath(groupId), { force: true });
      rmSync(reviewDiffPath(groupId), { force: true });
      rmSync(reviewSettingsPath(groupId), { force: true });
      rmSync(reviewGuidePath(groupId), { force: true });
    } catch {
      // invalid id / already gone — nothing to clean up
    }
    return true;
  }

  // --- PR-review guardrails ---

  /** Write the PR's diff to a file the review session can read, so the whole
   * change is in front of it without a `gh pr diff` round-trip. Pass `diff` on
   * create; omit on restart to keep whatever was captured before. Returns the
   * file path. */
  private ensureReviewDiff(groupId: string, diff?: string): string {
    mkdirSync(REVIEW_DIR, { recursive: true });
    const file = reviewDiffPath(groupId);
    if (diff != null) writeFileSync(file, diff);
    else if (!existsSync(file)) writeFileSync(file, "");
    return file;
  }

  /** Make sure the review pane's guide file exists (empty), so the Guide tab has
   * something to poll and Claude's `Edit` allow rule has a target from the
   * start. Kept across restart like the notepad. Returns the file path. */
  private ensureReviewGuide(groupId: string): string {
    mkdirSync(REVIEW_DIR, { recursive: true });
    const file = reviewGuidePath(groupId);
    if (!existsSync(file)) writeFileSync(file, "");
    return file;
  }

  /** The reading guide as the review session has written it so far (empty until
   * it has). Polled by the review pane's Guide tab. */
  readReviewGuide(groupId: string): string {
    try {
      return readFileSync(reviewGuidePath(groupId), "utf8");
    } catch {
      return "";
    }
  }

  /** Write a per-session Claude settings file carrying a review pane's deny
   * backstop + notepad allow (see buildReviewPermissions) and return its path,
   * for `--settings`. */
  private ensureReviewPerms(groupId: string): string {
    mkdirSync(REVIEW_DIR, { recursive: true });
    const settings = buildReviewPermissions(
      notepadPath(groupId),
      reviewGuidePath(groupId),
    );
    const file = reviewSettingsPath(groupId);
    writeFileSync(file, JSON.stringify(settings, null, 2));
    return file;
  }

  // --- Progress notepad ---
  private ensureNotepad(groupId: string, seed?: string): string {
    mkdirSync(PROGRESS_DIR, { recursive: true });
    const file = notepadPath(groupId);
    if (!existsSync(file)) {
      writeFileSync(file, seed ?? `# Handover\n\n${HANDOVER_TEMPLATE}`);
    }
    return file;
  }

  readNotepad(groupId: string): string {
    try {
      return readFileSync(notepadPath(groupId), "utf8");
    } catch {
      return "";
    }
  }

  writeNotepad(groupId: string, content: string) {
    mkdirSync(PROGRESS_DIR, { recursive: true });
    writeFileSync(notepadPath(groupId), content);
  }
}

export const sessions = new SessionManager();
