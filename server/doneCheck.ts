// den's done check: a Claude Code workflow (the Workflow tool) that a kit
// runs before it calls its work done. It scopes the change, sends badger and
// owl (plus hare or wolf when the change needs them) at once, and has a
// skeptic try to refute each serious finding, so the kit gets one ranked,
// checked report instead of calling each helper and merging their answers.
// The helpers are the pane's own subagents (kitAgents in crew.ts).
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./dataDir.ts";
import { logWarn } from "./log.ts";

export const DONE_CHECK_PATH = join(DATA_DIR, "workflows", "done-check.js");

/** Serious findings double-checked per run; the rest come back unverified.
 * Keeps a run to about ten agents. The script takes no more than twice this. */
export const DONE_CHECK_MAX_VERIFY = 5;

// Plain JavaScript for the Workflow tool, which can't use Date.now() or
// Math.random(). No template literals, so it can sit in String.raw.
export const DONE_CHECK_SCRIPT = String.raw`export const meta = {
  name: 'den-done-check',
  description: "den's done check: badger and owl, plus hare or wolf when the change needs them, with each serious finding double-checked",
  whenToUse: 'Before a den session says a piece of work is done',
  phases: [
    { title: 'Scope', detail: 'what changed, and which helpers it needs' },
    { title: 'Check', detail: 'the helpers review the change' },
    { title: 'Verify', detail: 'a skeptic tries to refute each serious finding' },
  ],
}

const base = (args && args.base) || ''
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
  'Work out what this branch changes, for a check before it is called done. ' +
    (base
      ? 'Its base is ' + base + '. '
      : 'Find its base: the pull request base (gh pr view --json baseRefName) if there is a PR, else the branch it was made from or the repo default branch. ') +
    'Read git diff <base>...HEAD and any uncommitted changes. Return the base you used, a two-line summary, ' +
    'the changed files, and whether the change touches performance (queries, loops over data, list rendering, ' +
    'hot paths) or security (auth, permissions, secrets, user input, data shared across accounts), with one ' +
    'line on why for each. Read only: change nothing.',
  { label: 'scope', phase: 'Scope', schema: SCOPE, effort: 'low' },
)
if (!scope) return { error: 'Could not work out what the branch changes.' }
if (!scope.files.length) return { base: scope.base, summary: 'Nothing changed against ' + scope.base + '.', crew: [], confirmed: [], unverified: [], refuted: [] }

const subject =
  'the change on this branch against ' + scope.base + ', uncommitted changes included (' +
  scope.files.length + ' files: ' + scope.files.slice(0, 40).join(', ') + '). What it does: ' + scope.summary
const crew = [
  { name: 'badger', ask: 'Check ' + subject + '\nRun the tests that cover it and try to break it.' },
  { name: 'owl', ask: 'Review ' + subject },
]
if (scope.performance) crew.push({ name: 'hare', ask: 'Check ' + subject + '\nfor slow paths. Why it may matter: ' + (scope.performanceWhy || '') })
if (scope.security) crew.push({ name: 'wolf', ask: 'Review ' + subject + '\nfor security. Why it may matter: ' + (scope.securityWhy || '') })
log('Checking with ' + crew.map((c) => c.name).join(', '))

const RETURN =
  '\nReturn every finding with its severity (high: wrong behaviour, data loss, or a security hole; medium: a ' +
  'real bug in an edge case, or a missing test on core behaviour; low: polish), where (file:line), the ' +
  'problem, the fix, and your evidence; then what you checked, and what you could not.'

// Every helper's findings first (a barrier), so the double-checks go to the
// most serious ones rather than to whichever helper finished first.
const reports = await parallel(
  crew.map((c) => () => agent(c.ask + RETURN, { label: c.name, phase: 'Check', agentType: c.name, schema: FINDINGS })),
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

/** What den pastes into a kit to run the done check. The developer's click
 * is the ask: a session runs a workflow only when asked to. */
export function doneCheckPrompt(base: string | null, scriptPath = DONE_CHECK_PATH): string {
  const baseArg = base ? `"${base.replaceAll('"', "")}"` : `"<the branch this one is based on>"`;
  return (
    `Run den's done check on your work now: call the Workflow tool with scriptPath ` +
    `"${scriptPath}" and args {"base": ${baseArg}}. When it returns, fix what it ` +
    `confirmed, worst first, and judge its unverified findings yourself. If it ` +
    `returned an error or a helper failed, say so: that part wasn't checked. Then ` +
    `say in your handover who checked what, and tell me in a few lines what it found ` +
    `and what you changed.`
  );
}

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
