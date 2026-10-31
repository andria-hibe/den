// Every prompt den pastes into a Claude pane lives here so prompts.test.ts can
// hold each to ASCII: a prompt with an em dash teaches the pane to write one
// back, and a review pane's output is pasted into GitHub.
//
// The review prompts mirror the shape reviewInstruction (server/sessions.ts)
// sets, so den can render what the session writes. Change them together.
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

/** Ask a review pane for the review, in the structure parseReview files per
 * file. */
export function reviewPrompt(number: number, repo: string, owned = false): string {
  return (
    `Please review pull request #${number} (${repo}). The PR's full diff has been ` +
    `saved to a file for you (see your instructions) and the PR is checked out in ` +
    `your working directory. ` +
    (owned
      ? `Report first: don't change, commit, or post anything as part of this review. `
      : `Run whatever you need, but don't commit or push, and keep any experiment ` +
        `on the scratch branch named in your instructions. `) +
    `Read the diff, then read the changed files for context. Do the finding pass ` +
    `with the code-review skill as your instructions describe, then write your review ` +
    `to the notepad as markdown in this shape: first the general review (a short ` +
    `**Summary**, a line each on the **Ticket**, **Consistency**, and **Intent** ` +
    `checks your instructions list, then any cross-cutting **Risks**), then one \`## <file path>\` ` +
    `heading per file you have comments on, with the exact path as it appears in ` +
    `the diff, and your comments on that file as bullets citing line numbers. Skip ` +
    `files you have nothing to say about. If it all looks solid, say so briefly.`
  );
}

/** The auto pre-review asks for both, guide first: it is the reading order for
 * the review that follows, and it lands while the finding pass is still running. */
export function autoReviewPrompt(number: number, repo: string, owned = false): string {
  return (
    `${guidePrompt(number, repo)}\n\nThen, once the guide file is saved, review ` +
    `the PR too. ${reviewPrompt(number, repo, owned)}`
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

/** A ticket's details as markdown, without its title. */
/** The ticket section of a workspace notepad. den keeps a copy and puts it
 * back if a rewrite drops it (#39). */
export function ticketDetails(issue: LinearIssue): string {
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

/** A ticket as markdown: the file a look pane's system prompt points at
 * (lookInstruction). */
export function ticketBrief(issue: LinearIssue): string {
  return `# ${issue.identifier}: ${issue.title}\n\n${ticketDetails(issue)}`;
}

/** The notepad a ticket workspace starts with: the empty handover first, so
 * it opens on where the work stands, then the ticket. After a restart this is
 * the session's only copy of the ticket. */
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
    "Read the ticket's comments in Linear too: decisions and scope changes " +
      "often live only there. Then, before writing any code, explain the issue " +
      "in your own words and propose a solution or approach. Don't make changes " +
      "yet. I'll decide the next step after your proposal.",
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

/** The clean-up session's first message (#29). With a skill, it names the
 * skill and lets it drive; without one, it carries the rules any clean-up of
 * a work repo needs. Either way the session plans first and changes nothing
 * until the developer approves: that part is den's, whatever the skill says. */
export function cleanupPrompt(skill: string | null): string {
  const gate =
    "Show me the plan first, grouped into safe to remove, needs my call, and keep, " +
    "and change nothing until I approve it.";
  if (skill) {
    return (
      `Use the ${skill} skill to clean up this work repo: merged worktrees, their ` +
      `local branches, and idle or orphaned container stacks. Run its audit, then ${gate[0].toLowerCase()}${gate.slice(1)}`
    );
  }
  return (
    "Clean up this work repo: merged worktrees, their local branches, and idle or " +
    "orphaned container stacks. Audit first without changing anything: for each " +
    "worktree and local branch other than the base branch, find its PR and whether " +
    "it merged (PRs may be squash-merged, so compare the local tip with the PR's " +
    "head commit instead of trusting git branch --merged), whether it is on the " +
    "remote, and any unpushed commits or uncommitted changes; and list container " +
    `stacks whose checkout is gone. ${gate} Never use --force or --hard, never ` +
    "touch the main checkout, and never discard uncommitted work."
  );
}

/** The helpers a pane's crew buttons can call: the subagents den gives it
 * (kitAgents / reviewAgents / managerAgents in server/crew.ts). */
export type CrewHelper = "owl" | "badger" | "hare" | "wolf" | "raccoon" | "tanuki" | "squirrel";

/** Which pane the crew buttons sit on: a kit (workspace or my-PR), a PR
 * review, or Fox. */
export type CrewPane = "kit" | "review" | "manager";

/** The helpers each pane kind has as subagents: a review pane is Owl itself,
 * so it has no Owl to call. */
export function crewFor(pane: CrewPane): CrewHelper[] {
  if (pane === "manager") return ["tanuki", "squirrel", "raccoon", "owl"];
  return pane === "review" ? ["badger", "hare", "wolf", "raccoon"] : ["owl", "badger", "hare", "wolf", "raccoon"];
}

/** What a crew button pastes. `submit: false` leaves it in the prompt for the
 * developer to finish, for a helper that needs to be told what to do.
 * `digest`: rewrite Fox's digest first, since the ask reads it and it was
 * written when the day started. */
export type CrewAsk = { text: string; submit: boolean; digest?: boolean };

export function crewAskPrompt(helper: CrewHelper, pane: CrewPane): CrewAsk {
  if (pane === "manager") {
    switch (helper) {
      case "tanuki":
        return {
          text:
            `Ask tanuki, your inbox subagent, to go through my inbox now. den has just rewritten ` +
            `the digest, so its Inbox section is current, including the open review threads on my ` +
            `PRs. Tell me what needs me, which PRs have work to do now and which session should do ` +
            `it, and what's worth knowing, and add anything that needs me to the Today list.`,
          submit: true,
          digest: true,
        };
      case "raccoon":
        return {
          text:
            `Give raccoon, your CI subagent, the failing checks on my open PRs (den has just ` +
            `rewritten the digest, which lists them by name with links). Tell me per PR whether ` +
            `it's a flake or real, and which session should fix it. If nothing fails, just say so.`,
          submit: true,
          digest: true,
        };
      case "squirrel":
        return { text: "Send squirrel, your errand subagent, on this errand and tell me what it finds: ", submit: false };
      case "owl":
        return { text: "Ask owl, your advisor subagent: ", submit: false };
    }
  }
  const review = pane === "review";
  const subject = review ? "this pull request" : "the change on this branch";
  const report = review
    ? "Fold anything that holds up into your review, then tell me briefly what it found."
    : "Tell me briefly what it found and what you'd do about it; don't change anything yet.";
  const ask = (text: string): CrewAsk => ({ text, submit: true });
  switch (helper) {
    case "owl":
      return ask(`Ask owl, your advisor subagent, to review the change on this branch against its base now. ${report}`);
    case "badger":
      return ask(`Ask badger, your testing subagent, to check ${subject} now: run the tests that cover it and try to break it. ${report}`);
    case "hare":
      return ask(`Ask hare, your performance subagent, to check ${subject} for slow paths now. ${report}`);
    case "wolf":
      return ask(`Ask wolf, your security subagent, to review ${subject} now. ${report}`);
    case "raccoon":
      return ask(
        `Check CI on ${review ? "this pull request" : "this branch's pull request"} with gh pr checks. ` +
          `If any check fails, give raccoon, your CI subagent, the failing checks' names and links, ` +
          `and tell me what it says. If nothing fails, just say so.`,
      );
    default:
      return ask(`Ask ${helper} now and tell me briefly what it found.`);
  }
}
