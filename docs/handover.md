# Handover, 2026-09-28

Written by the den self-edit session that started working the issue backlog in
priority order. It covers session state and reasoning that is not in CLAUDE.md
or the issues.

**Delete this file once issues 1-8 are closed.** It is a handover, not a second
roadmap. CLAUDE.md is the orientation doc, and
<https://github.com/andria-hibe/den/issues> is the backlog.

## State

- `6aa81dd` fixes issues 1, 2, and 3 and closes a gap from issue 24. It is
  committed on master and **not pushed**, so GitHub still shows #1-#3 open.
  Its `Closes` lines close them on push.
- `6aa81dd` and the commit that wrote this file are the only commits ahead of origin.
- `npm run check` is green at `6aa81dd`: 163 tests across 17 files. The one
  eslint warning (`useTerminal.ts:80`, `hostRef`) predates this session.
- **Batch 2 is half done, in `git stash@{0}`** ("WIP batch B"). Run
  `git stash pop` to pick it up. It has not been through `npm run check`.
- The app has not been repackaged. Andria launches the change themselves.

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

## What is in the stash

- #6: `ticketNotesSeed` and `ticketPrompt` moved from `App.tsx` into
  `prompts.ts`. The middots became `|` and `,`, and the em dash became a
  sentence break.
- #8: `denPrompt` moved into `prompts.ts` as a function, without the bold span
  or the em dashes. `App.tsx` calls `denPrompt()`.
- `prompts.test.ts` gains ASCII cases for all three and a `denPrompt` test.

Not started, #4: `progressInstruction` (`server/sessions.ts`) still has two
em dashes and never tells a session to read its notepad. Rewrite it in ASCII,
add "if the file already has entries, read it first", export it, and give it
an ASCII test next to `reviewInstruction.test.ts`. Then `npm run check`,
commit, and close #4, #6, and #8 in the message.

## Priority order for what is left

1. #4, #6, #8: finish the stash. This is batch 2.
2. #24, #5, #7: one instruction builder, in the shape of `reviewInstruction`
   and shared by `create()` and `restartArgs`, for work, my-PR, and look
   panes. #24's draft-PR rule goes in the work-pane version.
3. #22: `baseRef` branches off `master` instead of the repo's base branch.
4. The rest in issue-number order: #13, #19, #17, #15, #23, #11, #14, #18,
   #16, #10, #21, #20, #12.

## Ground rules from these sessions

- Do not run `npm run pack`, reinstall, or reopen the app. Andria controls when
  the running app is replaced.
- Add new work as a GitHub issue, not as a bullet in CLAUDE.md.
- `npm run check` is the gate. Prettier is not part of it, and CLAUDE.md is not
  Prettier-formatted.
