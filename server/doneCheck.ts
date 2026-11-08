// den's checks: one Claude Code workflow (the Workflow tool) with two modes.
// The ready check, which a kit runs before its PR goes to a human reviewer,
// sends a requirements pass (ticket, PR description, and every comment on the
// PR), owl, badger, and a tidy pass, plus hare, wolf, or bowerbird when the
// change needs them; the deep review, which a review pane runs on a
// colleague's PR, sends a code-review pass, a ticket check, and badger, hare,
// wolf, or bowerbird. Either way a skeptic then
// tries to refute each serious finding, so the pane gets one ranked, checked
// report with each finding's source instead of merging helpers' answers.
// The helpers are the pane's own subagents (kitAgents / reviewAgents in crew.ts).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "./dataDir.ts";
import { logWarn } from "./log.ts";
import { CHECKS_DIR } from "./paths.ts";
import { commentRules, testingRules } from "./instructions.ts";

export const DONE_CHECK_PATH = join(DATA_DIR, "workflows", "den-check.js");

export { CHECKS_DIR };
export const checkResultPath = (groupId: string) => join(CHECKS_DIR, `${groupId}.json`);

/** Serious findings double-checked per run; the rest come back unverified.
 * Keeps a run to about ten agents. The script takes no more than twice this. */
export const DONE_CHECK_MAX_VERIFY = 5;

// Plain JavaScript for the Workflow tool, which can't use Date.now() or
// Math.random(). No template literals, so it can sit in String.raw.
export const DONE_CHECK_SCRIPT = String.raw`export const meta = {
  name: 'den-check',
  description: "den's check of a change: the crew reviews it in parallel and a skeptic double-checks each serious finding",
  whenToUse: "A den session's ready-for-review check of its own PR (mode done) or deep review of a colleague's PR (mode review)",
  phases: [
    { title: 'Scope', detail: 'what changed, and which helpers it needs' },
    { title: 'Check', detail: 'the helpers review the change' },
    { title: 'Verify', detail: 'a skeptic tries to refute each serious finding' },
  ],
}

const base = (args && args.base) || ''
const reviewing = !!(args && args.mode === 'review')
// The pane fills args, so a raised limit is still bounded.
const MAX_VERIFY = Math.min((args && args.maxVerify) || ${DONE_CHECK_MAX_VERIFY}, ${DONE_CHECK_MAX_VERIFY * 2})

const SCOPE = {
  type: 'object',
  properties: {
    base: { type: 'string' },
    summary: { type: 'string' },
    files: { type: 'array', items: { type: 'string' } },
    performance: { type: 'boolean' },
    performanceWhy: { type: 'string' },
    security: { type: 'boolean' },
    securityWhy: { type: 'string' },
    ui: { type: 'boolean' },
    uiWhy: { type: 'string' },
    pr: { type: 'string' },
    tripwires: {
      type: 'array',
      items: {
        type: 'object',
        properties: { risk: { type: 'string' }, why: { type: 'string' }, humanTesting: { type: 'string' } },
        required: ['risk', 'why'],
      },
    },
  },
  required: ['base', 'summary', 'files', 'performance', 'security', 'ui'],
}
const FINDINGS = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
          where: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
          evidence: { type: 'string' },
        },
        required: ['severity', 'where', 'problem', 'fix'],
      },
    },
    checked: { type: 'string' },
    notChecked: { type: 'string' },
  },
  required: ['findings', 'checked'],
}
const VERDICT = {
  type: 'object',
  properties: { refuted: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['refuted', 'reason'],
}

phase('Scope')
const scope = await agent(
  (reviewing
    ? "Work out what this pull request changes, for a review of a colleague's work. "
    : 'Work out what this branch changes, for a check that its pull request is ready for a human reviewer. ') +
    (base
      ? 'Its base is ' + base + '. '
      : 'Find its base: the pull request base (gh pr view --json baseRefName) if there is a PR, else the branch it was made from or the repo default branch. ') +
    (reviewing
      ? 'Read git diff <base>...HEAD only: ignore the working tree, which may hold a local experiment. '
      : 'Read git diff <base>...HEAD and any uncommitted changes. ') +
    'Return the base you used, a two-line summary, ' +
    'the changed files, and whether the change touches performance (queries, loops over data, list rendering, ' +
    'hot paths), security (auth, permissions, secrets, user input, data shared across accounts), or the UI ' +
    '(components, styles, layout, icons, copy on screen), with one ' +
    'line on why for each. Give the pull request url if there is one (gh pr view --json url). Size its blast radius: ' +
    "with the repo's skill for sizing a change's blast radius if it has one, else by checking for work per item in one request, " +
    'high-volume tables, schema or index changes, permissions or tenancy, data model changes, and anything a ' +
    'click-through of a review app cannot confirm. List each risk it hits with why, and what a human would have ' +
    'to test that an agent cannot (production-sized data, a real account), and count those hits as performance ' +
    'or security where they are. Read only: change nothing.',
  { label: 'scope', phase: 'Scope', schema: SCOPE, effort: 'medium' },
)
if (!scope) return { error: 'Could not work out what the branch changes.' }
if (!scope.files.length) return { base: scope.base, summary: 'Nothing changed against ' + scope.base + '.', crew: [], confirmed: [], unverified: [], refuted: [] }

const risks = (scope.tripwires || []).length
  ? '\nBlast-radius risks the scope found: ' + scope.tripwires.map((t) => t.risk + ' (' + t.why + ')').join('; ') + '.'
  : ''
const subject =
  (reviewing ? "the pull request's change" : 'the change on this branch') + ' against ' + scope.base +
  (reviewing ? '' : ', uncommitted changes included') + ' (' +
  scope.files.length + ' files: ' + scope.files.slice(0, 40).join(', ') + '). What it does: ' + scope.summary
// "source" is the tag the finding carries in the review; "agentType" the pane's subagent, if any.
const crew = reviewing
  ? [
      {
        name: 'code-review',
        ask:
          'Review ' + subject + '\nRun Claude Code' + "'" + 's code-review skill at high effort on it (never with --comment or ' +
          '--fix), then cover what its scope misses: design, tests, naming, missing cases, and whether it follows the ' +
          "codebase's existing patterns and shared helpers. Use the repo's QA review skill too if it has one, against " +
          'this base. Change nothing.',
      },
      {
        name: 'ticket',
        ask:
          "Find this pull request's Linear ticket (its id is usually in the branch name, the title, or the " +
          'description) and read it, comments included, with your Linear tools, changing nothing. Check ' + subject +
          '\nagainst it: report each requirement or acceptance criterion it does not meet, and anything it does that ' +
          "the ticket doesn't ask for. If you can't find or read the ticket, say so in what you could not check.",
      },
      { name: 'badger', agentType: 'badger', ask: 'Check ' + subject + '\nRun the tests that cover it and try to break it.' },
    ]
  : [
      {
        name: 'requirements',
        ask:
          'Check that ' + subject + '\nis ready for a human engineer to review: everything asked for is done, ' +
          'nothing more, and nobody is left waiting. Read, changing nothing anywhere: the Linear ticket (its id is ' +
          'usually in the branch name, the PR title, or the description) and all its comments, with your Linear ' +
          'tools, since the discussion often changes the scope; and the pull request ' + (scope.pr || '(none yet)') +
          ": its description, conversation, reviews, and review threads (with the repo's skill for reading PR " +
          'comments if it has one, else gh pr view --comments and gh api for the review threads). Product and ' +
          'design often comment before an engineer does. Report: each requirement or acceptance criterion not ' +
          'met; each comment or thread not yet answered by a change or a reply; anything the change does that ' +
          'nobody asked for (unrelated edits, refactors, scope creep); and what the description lacks for a ' +
          'reviewer (what and why, how it was tested, before and after screenshots for a visual change, the ' +
          'blast-radius risks a human must test). If there is no ticket or no PR, say so in what you could not check.' +
          risks,
        effort: 'medium',
      },
      {
        name: 'owl',
        agentType: 'owl',
        ask:
          'Review ' + subject + '\nfor bugs first, then risky design. A senior engineer reads it next. Other ' +
          'passes check the ticket and the codebase consistency, so spend your time on correctness.',
      },
      {
        name: 'badger',
        agentType: 'badger',
        ask:
          'Check ' + subject + '\nRun the tests that cover it, lint and type-check the changed files, and try to ' +
          'break it. Read the PR checks too (gh pr checks): name any that fail.',
      },
      {
        name: 'tidy',
        ask:
          'Check that ' + subject + '\nis clean, minimal, and consistent, so a reviewer has nothing to tidy. ' +
          'Not bugs: others look for those. Report: comments that break the rules below (name each to cut or ' +
          'rewrite); tests that break the rules below (low value, or covered by another test: name each to cut); ' +
          'debug leftovers, dead or commented-out code; changes that make it more complicated than the task needs ' +
          '(an abstraction with one use, options nobody passes, defensive code for cases that cannot happen); new ' +
          'code that duplicates a helper or component the codebase already has; and names, structure, or patterns ' +
          'out of step with the code around it. Which tests the ticket or core behaviour needs is the tester' +
          "'" + 's call: only name a test to cut when it is low value or duplicated. Change nothing.\n' +
          ${JSON.stringify(commentRules())} + '\n' + ${JSON.stringify(testingRules())},
        effort: 'medium',
      },
    ]
if (scope.performance) crew.push({ name: 'hare', agentType: 'hare', ask: 'Check ' + subject + '\nfor slow paths. Why it may matter: ' + (scope.performanceWhy || '') + risks })
if (scope.security) crew.push({ name: 'wolf', agentType: 'wolf', ask: 'Review ' + subject + '\nfor security. Why it may matter: ' + (scope.securityWhy || '') + risks })
if (scope.ui) crew.push({ name: 'bowerbird', agentType: 'bowerbird', ask: 'Review ' + subject + '\nfor design consistency. Why it may matter: ' + (scope.uiWhy || '') })
log('Checking with ' + crew.map((c) => c.name).join(', '))

const RETURN =
  '\nReturn every finding with its severity (high: wrong behaviour, data loss, a security hole, or a requirement ' +
  'or acceptance criterion not met; medium: a real bug in an edge case, a missing test on core behaviour, a PR ' +
  'comment or thread with no answer, or a change nobody asked for; low: polish), where (file:line), the ' +
  'problem, the fix, and your evidence; then what you checked, and what you could not.'

// Every helper's findings first (a barrier), so the double-checks go to the
// most serious ones rather than to whichever helper finished first.
const reports = await parallel(
  crew.map((c) => () =>
    agent(
      c.ask + RETURN,
      Object.assign(
        { label: c.name, phase: 'Check', schema: FINDINGS },
        c.agentType ? { agentType: c.agentType } : {},
        c.effort ? { effort: c.effort } : {},
      ),
    ),
  ),
)
const RANK = { high: 0, medium: 1, low: 2 }
const byRank = (a, b) => RANK[a.severity] - RANK[b.severity]
const findings = []
crew.forEach((c, i) => {
  for (const f of (reports[i] && reports[i].findings) || []) findings.push(Object.assign({}, f, { from: c.name, verdict: null, capped: false }))
})
const serious = findings.filter((f) => f.severity !== 'low').sort(byRank)
serious.slice(MAX_VERIFY).forEach((f) => { f.capped = true })
if (serious.length > MAX_VERIFY) log((serious.length - MAX_VERIFY) + ' serious findings were not double-checked (limit ' + MAX_VERIFY + ' a run)')

phase('Verify')
const verdicts = await parallel(
  serious.slice(0, MAX_VERIFY).map((f) => () =>
    agent(
      f.from + ' reported this about ' + subject + '\n' + JSON.stringify(f) + '\n' +
        (f.from === 'requirements'
          ? 'Try to refute it. Re-read the ticket and its comments with your Linear tools and the pull request ' +
            'with gh, read only, and the code where it settles it. '
          : 'Try to refute it. Read the code and, where it is cheap, run it. ') +
        'Set refuted to true if it is wrong, ' +
        'already handled, or cannot happen; if after looking you are unsure, set it to false and say what you found. ' +
        'Change nothing.',
      { label: 'verify ' + f.from + ': ' + f.where, phase: 'Verify', schema: VERDICT, effort: 'medium' },
    ),
  ),
)
serious.slice(0, MAX_VERIFY).forEach((f, i) => {
  if (verdicts[i]) f.verdict = verdicts[i]
  else f.verifyFailed = true
})

const confirmed = findings.filter((f) => f.verdict && !f.verdict.refuted).sort(byRank)
const unverified = findings.filter((f) => !f.verdict).sort(byRank)
const failed = crew.filter((c, i) => !reports[i]).map((c) => c.name)
const open = confirmed.concat(unverified).filter((f) => f.severity !== 'low')
return {
  base: scope.base,
  summary: scope.summary,
  pr: scope.pr || '',
  tripwires: scope.tripwires || [],
  // Ready (the kit's own PR only): nothing serious left open, and every helper reported.
  ready: reviewing ? undefined : open.length === 0 && failed.length === 0,
  crew: crew.map((c, i) => ({
    name: c.name,
    failed: !reports[i],
    checked: (reports[i] && reports[i].checked) || '',
    notChecked: (reports[i] && reports[i].notChecked) || '',
  })),
  confirmed,
  unverified,
  refuted: findings.filter((f) => f.verdict && f.verdict.refuted),
}
`;

/** A check result as a pane saved it, kept to the shape the results view
 * draws, or null when it isn't one: the model writes the file by hand. */
export function validCheckResult(x: unknown): Record<string, unknown> | null {
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;
  const o = x as Record<string, unknown>;
  const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const finding = (f: unknown) => {
    if (!f || typeof f !== "object") return null;
    const r = f as Record<string, unknown>;
    const severity = r.severity === "high" || r.severity === "medium" || r.severity === "low" ? r.severity : "low";
    const v = r.verdict as Record<string, unknown> | null | undefined;
    return {
      severity,
      where: str(r.where, 300) ?? "",
      problem: str(r.problem) ?? "",
      fix: str(r.fix) ?? "",
      evidence: str(r.evidence),
      from: str(r.from, 40) ?? "?",
      verdict: v && typeof v === "object" ? { refuted: v.refuted === true, reason: str(v.reason) ?? "" } : null,
      capped: r.capped === true,
      verifyFailed: r.verifyFailed === true,
    };
  };
  const findings = (v: unknown) => (Array.isArray(v) ? v.slice(0, 100).map(finding).filter(Boolean) : []);
  const crew = Array.isArray(o.crew)
    ? o.crew.slice(0, 20).flatMap((c) => {
        if (!c || typeof c !== "object") return [];
        const r = c as Record<string, unknown>;
        return [{ name: str(r.name, 40) ?? "?", failed: r.failed === true, checked: str(r.checked) ?? "", notChecked: str(r.notChecked) ?? "" }];
      })
    : [];
  const tripwires = Array.isArray(o.tripwires)
    ? o.tripwires.slice(0, 20).flatMap((t) => {
        if (!t || typeof t !== "object") return [];
        const r = t as Record<string, unknown>;
        const risk = str(r.risk, 300);
        return risk ? [{ risk, why: str(r.why) ?? "", humanTesting: str(r.humanTesting) }] : [];
      })
    : [];
  return {
    base: str(o.base, 200),
    summary: str(o.summary),
    error: str(o.error),
    pr: str(o.pr, 300),
    ready: typeof o.ready === "boolean" ? o.ready : undefined,
    tripwires,
    crew,
    confirmed: findings(o.confirmed),
    unverified: findings(o.unverified),
    refuted: findings(o.refuted),
  };
}

/** What den pastes into a kit to run the ready check. The developer's click
 * is the ask: a session runs a workflow only when asked to. */
export function doneCheckPrompt(base: string | null, resultPath: string, scriptPath = DONE_CHECK_PATH): string {
  return (
    `Run den's ready check on your work now: is this pull request ready for a human ` +
    `engineer to review, as an easy approval? Call the Workflow tool with scriptPath ` +
    `"${scriptPath}" and args {"base": ${baseArg(base)}}. It re-reads the ticket and ` +
    `its discussion and every comment on the PR, sizes the blast radius, and has the ` +
    `crew check requirements, bugs, tests, tidiness, and performance, security, and ` +
    `design where the change touches them, then a skeptic tries to refute each ` +
    `serious finding. When it returns, save the object it returned, as JSON, to ` +
    `${resultPath}, where den shows it. Then work through it, worst first: fix what it ` +
    `confirmed, and judge the rest yourself: cut a comment or test it names as low ` +
    `value, or undo a change it says nobody asked for, only where you agree, and list ` +
    `what you cut or undid. For each PR comment or thread still waiting on an answer, ` +
    `make the change or draft a reply for me to post. If there is a PR, bring its ` +
    `description up to date: what and why, how it was tested (commands and results ` +
    `from what the check ran), and the blast-radius risks a human must test; for ` +
    `screenshots of a visual change, give me the file paths to attach. Leave the PR ` +
    `a draft, and if there is no PR yet, don't open one: tell me. If ` +
    `it returned an error or a helper failed, say so: that part wasn't checked. Don't ` +
    `run the check again on your own. Say in your handover who checked what, then ` +
    `tell me in a few lines what it found and what you changed, and end with a ` +
    `verdict: ready for review, or what is still in the way.`
  );
}

/** What den pastes into a review pane for a deep review of the PR. */
export function deepReviewPrompt(base: string | null, resultPath: string, scriptPath = DONE_CHECK_PATH): string {
  return (
    `Run den's deep review of this pull request now: call the Workflow tool with ` +
    `scriptPath "${scriptPath}" and args {"mode": "review", "base": ${baseArg(base)}}. ` +
    `It runs a code-review pass, a ticket check, and the crew in parallel, then has a ` +
    `skeptic try to refute each serious finding. When it returns, save the object it ` +
    `returned, as JSON, to ${resultPath}, where den shows it. Then write the review ` +
    `file from it as your instructions describe: each confirmed finding as a bullet ` +
    `with its source tag marked verified (its "from" field, as in [ticket, verified]), ` +
    `the unverified ones only if you judge them real after reading the code, no ` +
    `refuted ones, and the Checked section from what each helper checked and ` +
    `couldn't. Write the reading guide first if there isn't one yet.`
  );
}

const baseArg = (base: string | null) =>
  base ? `"${base.replaceAll('"', "")}"` : `"<the branch this one is based on>"`;

/** Write the script where panes can run it by path, when it has changed. */
export function ensureDoneCheckScript(): void {
  ensureScript(DONE_CHECK_PATH, DONE_CHECK_SCRIPT);
}

/** Write a workflow script to `path` when its text has changed. */
export function ensureScript(path: string, script: string): void {
  try {
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      // not written yet
    }
    if (current === script) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.tmp`, script);
    renameSync(`${path}.tmp`, path);
  } catch (err) {
    logWarn("workflow script", err);
  }
}
