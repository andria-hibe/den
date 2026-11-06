// den's checks: one Claude Code workflow (the Workflow tool) with two modes.
// The done check, which a kit runs before it calls its work done, sends
// badger and owl (plus hare or wolf when the change needs them); the deep
// review, which a review pane runs on a colleague's PR, sends a code-review
// pass, a ticket check, and badger, hare, or wolf. Either way a skeptic then
// tries to refute each serious finding, so the pane gets one ranked, checked
// report with each finding's source instead of merging helpers' answers.
// The helpers are the pane's own subagents (kitAgents / reviewAgents in crew.ts).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./dataDir.ts";
import { logWarn } from "./log.ts";

export const DONE_CHECK_PATH = join(DATA_DIR, "workflows", "den-check.js");

/** Where a pane saves the object a check returned, for den to show. */
export const CHECKS_DIR = join(DATA_DIR, "checks");
export const checkResultPath = (groupId: string) => join(CHECKS_DIR, `${groupId}.json`);

/** Serious findings double-checked per run; the rest come back unverified.
 * Keeps a run to about ten agents. The script takes no more than twice this. */
export const DONE_CHECK_MAX_VERIFY = 5;

// Plain JavaScript for the Workflow tool, which can't use Date.now() or
// Math.random(). No template literals, so it can sit in String.raw.
export const DONE_CHECK_SCRIPT = String.raw`export const meta = {
  name: 'den-check',
  description: "den's check of a change: the crew reviews it in parallel and a skeptic double-checks each serious finding",
  whenToUse: "A den session's done check (mode done) or deep review of a pull request (mode review)",
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
  },
  required: ['base', 'summary', 'files', 'performance', 'security'],
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
    : 'Work out what this branch changes, for a check before it is called done. ') +
    (base
      ? 'Its base is ' + base + '. '
      : 'Find its base: the pull request base (gh pr view --json baseRefName) if there is a PR, else the branch it was made from or the repo default branch. ') +
    (reviewing
      ? 'Read git diff <base>...HEAD only: ignore the working tree, which may hold a local experiment. '
      : 'Read git diff <base>...HEAD and any uncommitted changes. ') +
    'Return the base you used, a two-line summary, ' +
    'the changed files, and whether the change touches performance (queries, loops over data, list rendering, ' +
    'hot paths) or security (auth, permissions, secrets, user input, data shared across accounts), with one ' +
    'line on why for each. Read only: change nothing.',
  { label: 'scope', phase: 'Scope', schema: SCOPE, effort: 'low' },
)
if (!scope) return { error: 'Could not work out what the branch changes.' }
if (!scope.files.length) return { base: scope.base, summary: 'Nothing changed against ' + scope.base + '.', crew: [], confirmed: [], unverified: [], refuted: [] }

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
      { name: 'badger', agentType: 'badger', ask: 'Check ' + subject + '\nRun the tests that cover it and try to break it.' },
      { name: 'owl', agentType: 'owl', ask: 'Review ' + subject },
    ]
if (scope.performance) crew.push({ name: 'hare', agentType: 'hare', ask: 'Check ' + subject + '\nfor slow paths. Why it may matter: ' + (scope.performanceWhy || '') })
if (scope.security) crew.push({ name: 'wolf', agentType: 'wolf', ask: 'Review ' + subject + '\nfor security. Why it may matter: ' + (scope.securityWhy || '') })
log('Checking with ' + crew.map((c) => c.name).join(', '))

const RETURN =
  '\nReturn every finding with its severity (high: wrong behaviour, data loss, or a security hole; medium: a ' +
  'real bug in an edge case, or a missing test on core behaviour; low: polish), where (file:line), the ' +
  'problem, the fix, and your evidence; then what you checked, and what you could not.'

// Every helper's findings first (a barrier), so the double-checks go to the
// most serious ones rather than to whichever helper finished first.
const reports = await parallel(
  crew.map((c) => () =>
    agent(c.ask + RETURN, Object.assign({ label: c.name, phase: 'Check', schema: FINDINGS }, c.agentType ? { agentType: c.agentType } : {})),
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
        'Try to refute it. Read the code and, where it is cheap, run it. Set refuted to true if it is wrong, ' +
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

return {
  base: scope.base,
  summary: scope.summary,
  crew: crew.map((c, i) => ({
    name: c.name,
    failed: !reports[i],
    checked: (reports[i] && reports[i].checked) || '',
    notChecked: (reports[i] && reports[i].notChecked) || '',
  })),
  confirmed: findings.filter((f) => f.verdict && !f.verdict.refuted).sort(byRank),
  unverified: findings.filter((f) => !f.verdict).sort(byRank),
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
  return {
    base: str(o.base, 200),
    summary: str(o.summary),
    error: str(o.error),
    crew,
    confirmed: findings(o.confirmed),
    unverified: findings(o.unverified),
    refuted: findings(o.refuted),
  };
}

/** What den pastes into a kit to run the done check. The developer's click
 * is the ask: a session runs a workflow only when asked to. */
export function doneCheckPrompt(base: string | null, resultPath: string, scriptPath = DONE_CHECK_PATH): string {
  return (
    `Run den's done check on your work now: call the Workflow tool with scriptPath ` +
    `"${scriptPath}" and args {"base": ${baseArg(base)}}. When it returns, save the ` +
    `object it returned, as JSON, to ${resultPath}, where den shows it. Then fix ` +
    `what it confirmed, worst first, and judge its unverified findings yourself. If ` +
    `it returned an error or a helper failed, say so: that part wasn't checked. Then ` +
    `say in your handover who checked what, and tell me in a few lines what it found ` +
    `and what you changed. If the PR description has a testing section, draft its ` +
    `list of what was verified (commands and results) from what the check ran.`
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
  try {
    let current = "";
    try {
      current = readFileSync(DONE_CHECK_PATH, "utf8");
    } catch {
      // not written yet
    }
    if (current === DONE_CHECK_SCRIPT) return;
    mkdirSync(join(DATA_DIR, "workflows"), { recursive: true });
    writeFileSync(`${DONE_CHECK_PATH}.tmp`, DONE_CHECK_SCRIPT);
    renameSync(`${DONE_CHECK_PATH}.tmp`, DONE_CHECK_PATH);
  } catch (err) {
    logWarn("done check script", err);
  }
}
