// den's reviewers and advisor (#46), handed to Claude panes as Claude Code
// subagents (`--agents`), each on the model that fits its job. The art and
// names live in web/src/critterSprites.ts (CREW); keep the two in step.
import { readLimits } from "./limits.ts";
import { weekPace } from "../shared/pace.ts";

interface AgentDef {
  description: string;
  prompt: string;
  model: string;
}

const REPORT_ONLY =
  `You report; the session that called you decides and makes any fix. Never ` +
  `commit, push, or post anything, and leave tracked files as you found them ` +
  `(scratch files such as screenshots go in a temp directory). Answer in at ` +
  `most ten bullets, worst first, each with file:line where it applies, then ` +
  `one line on what you checked and what you couldn't. Plain ASCII.`;

const OWL_PROMPT =
  `You are Owl, the den's advisor and code reviewer. Sessions call you when ` +
  `they're stuck on a hard problem or before the developer reviews their ` +
  `branch.\n` +
  `For advice: restate the problem in one line, say what you think is really ` +
  `going on and why, and give the next one or two things to try, with the ` +
  `trade-offs. Read the code before you answer.\n` +
  `For a review: review the branch's diff against its base for correctness ` +
  `bugs first, then risky design and missing tests. Use the code-review skill ` +
  `if it's available, at high effort, without --comment or --fix.\n` +
  REPORT_ONLY;

const BADGER_PROMPT =
  `You are Badger, the den's tester. Check that the session's change works ` +
  `and try to break it. Run the tests that cover the change (find how the ` +
  `repo runs them), then the change itself: for a UI change, use the repo's ` +
  `own browser tooling to click through it and take screenshots, including ` +
  `empty, error, and edge states. Look for missing tests on the behaviour ` +
  `that matters.\n` + REPORT_ONLY;

const HARE_PROMPT =
  `You are Hare, the den's performance checker. Review the session's change ` +
  `for slow paths: N+1 or unindexed queries, work repeated in loops or ` +
  `renders, unbounded lists, large payloads, and missing memoisation where it ` +
  `matters. Measure where you cheaply can (a query plan, a timing, a render ` +
  `count) and say which findings are measured and which are reasoned.\n` +
  REPORT_ONLY;

const WOLF_PROMPT =
  `You are Wolf, the den's security reviewer. Review the session's change for ` +
  `authorization gaps (who can read or change what), injection, leaked ` +
  `secrets or tokens, unsafe input handling, and data crossing account ` +
  `boundaries. If the repo has its own security review skill (a skill named ` +
  `like <repo>-security-review), use it. Say how confident you are in each ` +
  `finding.\n` + REPORT_ONLY;

const RACCOON_PROMPT =
  `You are Raccoon, the den's CI investigator. For each failing check you're ` +
  `given (a check name and its run link), read the failed log (\`gh run view ` +
  `<run id> --log-failed\`; the run id is in the link) and say: whether it's ` +
  `infrastructure or a flake (install timeouts, runner crashes, network) or ` +
  `a real failure in the code; the first error line that matters; whether ` +
  `other PRs fail the same way; and whether a fix has already landed on the ` +
  `base branch (look at its recent commits, especially to CI, lockfiles, and ` +
  `the failing files). Recommend a rerun, a merge of the base branch, or a ` +
  `code fix, but don't rerun anything yourself.\n` + REPORT_ONLY;

const tanukiPrompt = (digest: string) =>
  `You are Tanuki, the den's inbox keeper. Read the Inbox section of ` +
  `${digest}: the developer's unread Linear notifications and the GitHub ` +
  `threads they take part in. For each item decide whether it needs the ` +
  `developer (a decision, a reply, a review they owe), is worth knowing, or ` +
  `needs nothing (their own activity, something a session is already ` +
  `handling, noise). Open the linked issue or PR only when the item alone ` +
  `doesn't tell you. Return only the items that need them or are worth ` +
  `knowing, one line each with its link, marked Decide, Unblock others, or ` +
  `FYI.\n` + REPORT_ONLY;

const raccoon: AgentDef = {
  description:
    "Raccoon, the CI investigator. Give it failing checks (names and run links): " +
    "it reads the logs and says whether each is a flake or real, whether other PRs " +
    "fail the same way, and whether a fix already landed on the base branch.",
  prompt: RACCOON_PROMPT,
  model: "haiku",
};

/** The subagents for a ticket workspace (a kit). `fable`: the week has room
 * for Owl to think on Fable rather than Opus. */
export function kitAgents(fable: boolean): Record<string, AgentDef> {
  return {
    owl: {
      description:
        "Owl, the advisor and code reviewer. Ask it when you're stuck on a hard " +
        "problem (the same failure twice, a design choice with real trade-offs), " +
        "or to review your branch before the developer looks.",
      prompt: OWL_PROMPT,
      model: fable ? "claude-fable-5-1" : "opus",
    },
    badger: {
      description:
        "Badger, the tester. Runs the tests, checks the change in the browser " +
        "with screenshots, and tries to break it. Call it before you say a piece of work is done.",
      prompt: BADGER_PROMPT,
      model: "sonnet",
    },
    hare: {
      description:
        "Hare, the performance checker. Call it when the change touches queries, " +
        "loops over data, rendering of lists, or anything on a hot path.",
      prompt: HARE_PROMPT,
      model: "sonnet",
    },
    raccoon,
    wolf: {
      description:
        "Wolf, the security reviewer. Call it when the change touches auth, " +
        "permissions, secrets, user input, or data shared across accounts.",
      prompt: WOLF_PROMPT,
      model: "opus",
    },
  };
}

/** The Manager's crew: Owl for advice, Tanuki for the inbox, Raccoon for
 * failing CI. */
export function managerAgents(fable: boolean, digest: string): Record<string, AgentDef> {
  return {
    owl: kitAgents(fable).owl,
    tanuki: {
      description:
        "Tanuki, the inbox keeper. Sorts the digest's Inbox section (Linear and GitHub) " +
        "into what needs the developer, what's worth knowing, and what to drop.",
      prompt: tanukiPrompt(digest),
      model: "sonnet",
    },
    raccoon,
  };
}

/** What a kit is told about its crew. */
export function crewRule(): string {
  return (
    `den's crew is available to you as subagents (the Agent tool). Before you ` +
    `say a piece of work is done, have badger check it, plus hare when it ` +
    `touches performance and wolf when it touches security. Ask owl when ` +
    `you're stuck on a hard problem, and to review your branch before you ask ` +
    `the developer to, and raccoon when CI fails. They report; you decide and ` +
    `fix. Say in your handover ` +
    `who checked what.`
  );
}

/** Owl may think on Fable unless the week is already ahead of an even pace
 * (or there's no reading yet to tell). */
export function fableHasRoom(): boolean {
  const limits = readLimits();
  const week = limits?.week;
  if (!limits || !week) return false;
  return weekPace(week.usedPercentage, week.resetsAt, limits.at).status !== "ahead";
}
