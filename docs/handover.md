# Handover, 2026-09-28

Written by the den self-edit session that started working the issue backlog in
priority order. It covers session state and reasoning that is not in CLAUDE.md
or the issues.

**Delete this file once issues 1-8 are closed.** It is a handover, not a second
roadmap. CLAUDE.md is the orientation doc, and
<https://github.com/andria-hibe/den/issues> is the backlog.

## State

- Pushed to origin on 2026-09-28. The commits' `Closes` lines closed issues
  1-8 and 24, and #22 was closed by hand with its third case split into #26.
  **Issues 1-8 are closed, so this file can go.** Before deleting it, move the
  issue 10 correction below onto issue 10.
- `npm run check` is green: 190 tests across 19 files. The one eslint warning
  (`useTerminal.ts:80`, `hostRef`) predates these sessions.
- The installed app was repackaged at `6aa81dd` on 2026-09-28. Everything
  after that is not in it, including the base-branch fix.

## What `6aa81dd` did

- Moved the client paste prompts (`guidePrompt`, `reviewPrompt`,
  `autoReviewPrompt`, `fileReviewPrompt`, `notePrompt`) out of `PrViews.tsx`
  and `DiffView.tsx` into the pure `web/src/prompts.ts`. `prompts.test.ts`
  runs each through `isAscii`, which moved to `shared/ascii.ts` so the server
  and the client share one check. New paste prompts go in that module.
- #1: removed the three em dashes from `reviewPrompt`.
- #2: `fileReviewPrompt` tells the pane to answer in the terminal and leave
  the notepad and guide alone, and `reviewInstruction` says the same about
  follow-up questions in general.
- #3: `fileReviewPrompt` names the file and its `@@` hunk ranges in the saved
  diff instead of re-pasting the hunks. If the saved diff lacks the file,
  because it was truncated at 200,000 characters or the PR changed since,
  the prompt tells the pane to read `gh pr diff`. It gives hunk headers, not
  line numbers in the saved file, because the client's diff is fetched fresh
  and the saved one is a snapshot from session creation.
- #24 side gap: added `Bash(gh pr create:*)` to `buildReviewPermissions`.

## A correction to issue 2

`notePrompt` only goes to my-PR panes (`Notes` and `InlineComments` inside
`PrMyView`), not review panes, and my-PR panes have no notepad. So the
overwrite risk issue 2 describes applies only to `fileReviewPrompt`, and
`notePrompt` got no destination clause. That changes once issue 5 gives my-PR
panes an instruction.

## What batch 2 did

- #4: `progressInstruction` (`server/sessions.ts`) tells a session to read
  its notepad first when it has entries, since a restart does not re-inject
  the initial prompt and a ticket's text survives only in the notepad seed.
  It is ASCII, exported, and tested in `server/progressInstruction.test.ts`.
- #6: `ticketNotesSeed` and `ticketPrompt` moved from `App.tsx` into
  `prompts.ts`. The middots became `|` and `,`, and the em dash became a
  sentence break.
- #8: `denPrompt` moved into `prompts.ts` as a function, without the bold span
  or the em dashes.

## What batch 3 did

- One builder per pane kind, shared by `create()` and `restartArgs`:
  `workspaceArgs` and `singlePaneArgs` in `server/sessions.ts`. Before this, a
  my-PR or look pane got a bare `-n name` and no system prompt at all.
- #24: `houseRules()` (plain ASCII, every PR opens as a draft) is appended to
  workspace, my-PR, and look panes. There is no deny backstop for the draft
  rule; the issue explains why.
- #5: `myPrInstruction` names the PR, repo, and branch, says comments arrive
  pasted, and says to draft replies in the terminal rather than post them. No
  notepad, a decision the issue left open.
- #7: a look pane saves the ticket (`ticketBrief` in `prompts.ts`) to the
  group's notepad path, and `lookInstruction` points the session at it. A
  file instead of inlining the description, so a restart rebuilds the same
  prompt without the description on the session. A look pane created before
  this change gets a file that says den did not save the description.
- Verified live on an isolated server (`DEN_DB=<tmp> PORT=4399`): look,
  my-PR, and workspace panes spawn with their prompts (including `--draft`),
  a restart rebuilds the identical prompt, and closing a look pane deletes
  its ticket file.

## Found while verifying, not fixed

`resumeArgs` falls back to the newest conversation recorded in the pane's cwd
when the pane's own transcript does not exist yet. A pane restarted before
anyone typed in it has no transcript, so it resumes an unrelated conversation
from the same folder: in the work repo, another ticket's session. The fallback
exists for panes created before den pinned session ids. Filed as #25.

## Corrections to issue text

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

## What the #22 commit did

- `baseRef` (`server/git.ts`) resolves the repo's base branch: the
  `base_branch` override (`$DEN_BASE_BRANCH`, then the `base_branch` setting),
  then `origin/HEAD`, then GitHub's default branch, then `master`/`main`. It
  fetches that branch and prefers `origin/<name>` over a local copy. runn's
  base is `development` (both `origin/HEAD` and GitHub say so), so den had
  been branching every runn ticket off `origin/master`.
- There is no UI for the override. Set it with
  `sqlite3 ~/.den/den.db "INSERT OR REPLACE INTO settings VALUES ('base_branch', 'development')"`
  or `DEN_BASE_BRANCH`.
- `reviewInstruction` says to create the scratch branch with no base argument
  while the PR's branch is checked out, so the scratch branch starts from the
  PR's code.
- Verified against throwaway repos whose base is `development`: with a stale
  `master` present, in both worktree and local mode, new branches start at
  `development`. With `origin/HEAD` unset and no GitHub remote it falls back
  to `master`, and the override fixes that.
- Not done: the third case, stacking a ticket on the branch of the ticket
  before it. Split into #26.

## Priority order for what is left

1. The rest in issue-number order: #25, #26, #13, #19, #17, #15, #23, #11, #14, #18,
   #16, #10, #21, #20, #12.

## Ground rules from these sessions

- Do not run `npm run pack`, reinstall, or reopen the app unless andria asks.
  They control when the running app is replaced.
- Add new work as a GitHub issue, not as a bullet in CLAUDE.md.
- `npm run check` is the gate. Prettier is not part of it, and CLAUDE.md is not
  Prettier-formatted.
