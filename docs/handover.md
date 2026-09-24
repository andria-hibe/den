# Handover, 2026-09-25

Written by the den self-edit session that audited den's injected prompts and set
up the issue backlog. It covers session state and reasoning that is not in
CLAUDE.md or the issues.

**Delete this file once issues 1-8 are closed.** It is a handover, not a second
roadmap. CLAUDE.md is the orientation doc, and
<https://github.com/andria-hibe/den/issues> is the backlog.

## State

- 22 issues filed, numbered in impact order. Issue 9 is closed.
- `f5f4019` documents the app runner and replaces the CLAUDE.md roadmap with a
  pointer to the tracker.
- **Master is 3 commits ahead of origin and nothing is pushed.** `f5f4019` plus
  two commits that predate this session.
- No code changed this session. Every audit finding is an issue, not a fix.

## What the audit found

Den injects 10 prompt strings plus one permissions layer. They disagree with
each other, and the disagreements are issues 1-8. The pattern behind all of
them: `reviewInstruction` is careful (one builder shared by create and restart,
ASCII asserted by a test) and nothing else is. Panes for your own PRs and for
looking at a ticket get no instruction at all.

`reviewInstruction` is the model to copy for any new instruction.

## Start here

Issues 1, 2, and 3 are one sitting. They touch the same prompts, and doing them
separately means reading the same code three times.

Issue 1 needs a design decision first: the client-side prompts (`guidePrompt`,
`reviewPrompt`, `notePrompt`, `fileReviewPrompt`) are built inside components,
so they cannot be asserted ASCII where they stand. Lifting them to a pure
module is the fix, and it matches why `reviewInstruction` already lives apart
from the code that spawns the session. Do that before writing the test.

## Two corrections to the issue text

**Issue 10 overstates the privacy constraint.** It says runn's local
environment commands cannot live in this public repo. They already do:
`server/apprun.ts` contains `runn up`, `runn status`, and the
`.runn/project.env` parsing. The app runner is most of a starting point for
that issue, not a thing to work around.

**Issue 22's middle case already works.** A review pane creates its scratch
branch with no base, inside a worktree that has the PR checked out, so it
inherits the PR's branch. The issue asks to make that explicit in
`reviewInstruction` so a later edit cannot break it silently. It is not a bug
to fix.

## Ground rules from this session

- Do not run `npm run pack`, reinstall, or reopen the app. Andria controls when
  the running app is replaced.
- Add new work as a GitHub issue, not as a bullet in CLAUDE.md. The old roadmap
  drifted badly enough that a shipped feature never reached it.
- `npm run check` is the gate: 151 tests across 16 files, green at `f5f4019`.
  Prettier is not part of it, and CLAUDE.md is not Prettier-formatted.
