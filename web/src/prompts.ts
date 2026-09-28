// The prompts the PR views paste into a Claude session. They live here, apart
// from the components that send them, for the reason reviewInstruction lives
// apart from the code that spawns the session: they are rules the model reads,
// and prompts.test.ts holds every one of them to ASCII (shared/ascii.ts). A
// prompt with an em dash in it teaches the pane to write one back, and a review
// pane's output is pasted into GitHub.
//
// Each one mirrors the shape reviewInstruction (server/sessions.ts) sets, so den
// can render what the session writes. Change them together.
import type { PrReviewNote } from "../../server/github.ts";
import type { LinearIssue } from "../../server/linear.ts";
import { HANDOVER_TEMPLATE } from "../../shared/handover.ts";

/** Ask a review pane for the reading guide: the change grouped into sections by
 * purpose, most important first. A separate, cheaper ask than the review; it
 * lands first and gives you something to read while the finding pass runs. */
export function guidePrompt(number: number, repo: string): string {
  return (
    `Please write the reading guide for pull request #${number} (${repo}) to the ` +
    `guide file named in your instructions. Read the saved diff first, and the ` +
    `changed files for context. Group the changed files into sections by what ` +
    `they do, most important first (the core of the change, then supporting ` +
    `changes, then low-signal churn), and give each section a \`## \` heading, ` +
    `two to four lines on its purpose and impact, and a \`Files:\` line naming ` +
    `its files exactly as they appear in the diff. Every changed file goes in ` +
    `exactly one section. Don't review in the guide - findings go in the review.`
  );
}

/** Ask a review pane for the review. The PR is checked out in the session's
 * worktree, so Claude reads the diff and the code around it, and you can follow
 * up right there. The structure is what parseReview files per file. */
export function reviewPrompt(number: number, repo: string): string {
  return (
    `Please review pull request #${number} (${repo}). The PR's full diff has been ` +
    `saved to a file for you (see your instructions) and the PR is checked out in ` +
    `your working directory. Run whatever you need, but don't commit or push, and ` +
    `keep any experiment on the scratch branch named in your instructions. ` +
    `Read the diff, then read the changed files for context. Do the finding pass ` +
    `with the code-review skill as your instructions describe, then write your review ` +
    `to the notepad as markdown in this shape: first the general review (a short ` +
    `**Summary**, then any cross-cutting **Risks**), then one \`## <file path>\` ` +
    `heading per file you have comments on, with the exact path as it appears in ` +
    `the diff, and your comments on that file as bullets citing line numbers. Skip ` +
    `files you have nothing to say about. If it all looks solid, say so briefly.`
  );
}

/** The auto pre-review asks for both, guide first: it is the reading order for
 * the review that follows, and it lands while the finding pass is still running. */
export function autoReviewPrompt(number: number, repo: string): string {
  return (
    `${guidePrompt(number, repo)}\n\nThen, once the guide file is saved, review ` +
    `the PR too. ${reviewPrompt(number, repo)}`
  );
}

/** The `@@ -a,b +c,d @@` part of each hunk header in one file's diff, without
 * the trailing function context: enough for the session to find the hunks in
 * the saved diff, and it keeps source text (which may not be ASCII) out of the
 * prompt. */
export function hunkRanges(lines: string[]): string[] {
  return lines
    .map((l) => l.match(/^@@ [^@]* @@/)?.[0])
    .filter((h): h is string => !!h);
}

/** Ask a review pane for a targeted review of one file. It names the file and
 * its hunks instead of re-pasting them: the whole diff is already on disk
 * (reviewInstruction names it), and a large file's hunks would cost a few
 * thousand duplicated tokens in the most expensive pane den runs.
 *
 * It also says where the answer goes. A session told "the review goes in the
 * notepad, overwrite it" can reasonably answer a one-file question by rewriting
 * the notepad with one file's comments, which destroys the finished review. */
export function fileReviewPrompt(
  file: string,
  prNumber: number | undefined,
  lines: string[],
): string {
  const where = prNumber ? ` from PR #${prNumber}` : "";
  const hunks = hunkRanges(lines);
  const scope = hunks.length
    ? ` (hunks ${hunks.map((h) => `\`${h}\``).join(", ")})`
    : "";
  return (
    `Please give me a targeted review of the changes to \`${file}\`${where}. ` +
    `Its section of the saved diff starts at the \`diff --git\` line for that ` +
    `path${scope}; read it there, and the file itself for context. If the saved ` +
    `diff doesn't have it, the PR may have changed since it was saved, so read ` +
    `\`gh pr diff\` instead. Call out bugs, edge cases, and anything risky. ` +
    `Answer here in the terminal: this is a follow-up question, so leave the ` +
    `notepad review and the guide file exactly as they are.`
  );
}

/** Ask a my-PR pane to action one review or comment. The comment's own body and
 * diff hunk are quoted as they came from GitHub; only the framing is den's. */
export function notePrompt(prNumber: number, n: PrReviewNote & { kind: string }): string {
  const where = n.path
    ? ` on \`${n.path}\`${n.line ? ` (line ${n.line})` : ""}`
    : "";
  const hunk = n.diffHunk ? `\n\nRelevant diff:\n\`\`\`diff\n${n.diffHunk}\n\`\`\`` : "";
  return (
    `Please action this ${n.kind.replace(/_/g, " ").toLowerCase()} from ` +
    `@${n.author}${where} on PR #${prNumber}:\n\n"${n.body}"${hunk}`
  );
}

/** A ticket's details as markdown, without its title: state, branch, link,
 * and description. */
function ticketDetails(issue: LinearIssue): string {
  const parts = [`**State:** ${issue.state.name} | **Priority:** ${issue.priorityLabel}`];
  if (issue.branchName) parts.push(`**Branch:** \`${issue.branchName}\``);
  parts.push(
    `[Open in Linear](${issue.url})`,
    "",
    "## Ticket",
    "",
    issue.description?.trim() || "_(no description)_",
    "",
  );
  return parts.join("\n");
}

/** A ticket as markdown: title, state, branch, link, and description. A look
 * pane gets this as the file its system prompt points at (lookInstruction), so
 * the session can read the ticket you are both looking at. */
export function ticketBrief(issue: LinearIssue): string {
  return `# ${issue.identifier}: ${issue.title}\n\n${ticketDetails(issue)}`;
}

/** The notepad a ticket workspace starts with: the empty handover first, so
 * the notepad opens on where the work stands, then the ticket below it, so the
 * session has the ticket on disk. After a restart this is the only copy of the
 * ticket the session can see, which is why progressInstruction tells it to
 * read the notepad first. */
export function ticketNotesSeed(issue: LinearIssue): string {
  return (
    `# ${issue.identifier}: ${issue.title}\n\n${HANDOVER_TEMPLATE}\n---\n\n` +
    ticketDetails(issue)
  );
}

/** Claude's first message when you start work on a ticket: the ticket, then a
 * request to explain and propose before doing anything. */
export function ticketPrompt(issue: LinearIssue): string {
  return [
    `I'm starting work on this Linear ticket:`,
    "",
    `${issue.identifier}: ${issue.title}`,
    `State: ${issue.state.name}, priority: ${issue.priorityLabel}`,
    "",
    issue.description?.trim() || "(no description provided)",
    "",
    "Before writing any code, explain the issue in your own words and propose " +
      "a solution or approach. Don't make changes yet. I'll decide the next " +
      "step after your proposal.",
  ].join("\n");
}

/** The opener of every self-edit session. This is the session that writes
 * den's commit messages, CLAUDE.md, and issues, so its punctuation habits
 * spread the furthest. */
export function denPrompt(): string {
  return (
    `You're now working on den itself: the source of the very app this ` +
    `session is running inside (this is its repo). First read ./CLAUDE.md to get ` +
    `oriented on the architecture, conventions, and gotchas, then tell me briefly ` +
    `that you're ready. Important: do NOT run \`npm run pack\` or reinstall or ` +
    `reopen the app unless I explicitly ask. I control when the running app is ` +
    `replaced. Then wait for me to tell you what to change.`
  );
}
