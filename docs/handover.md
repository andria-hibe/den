# Handover, 2026-09-28

Written by the den self-edit session that started working the issue backlog in
priority order. It covers session state and reasoning that is not in CLAUDE.md
or the issues.

**Delete this file once issues 1-8 are closed.** It is a handover, not a second
roadmap. CLAUDE.md is the orientation doc, and
<https://github.com/andria-hibe/den/issues> is the backlog.

## State

- Two commits fix issues 1, 2, 3, 4, 6, and 8: `6aa81dd` (#1-#3) and the
  batch 2 commit (#4, #6, #8). Both are on master and **not pushed**, so
  GitHub still shows those issues open. Their `Closes` lines close them on
  push.
- `npm run check` is green: 171 tests across 18 files. The one eslint warning
  (`useTerminal.ts:80`, `hostRef`) predates these sessions.
- The installed app was repackaged at `6aa81dd` on 2026-09-28. Batch 2 is not
  in it yet.
- Issues 5 and 7 are what keeps this file alive.

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

## Priority order for what is left

1. #24, #5, #7: one instruction builder, in the shape of `reviewInstruction`
   and shared by `create()` and `restartArgs`, for work, my-PR, and look
   panes. #24's draft-PR rule goes in the work-pane version.
2. #22: `baseRef` branches off `master` instead of the repo's base branch.
3. The rest in issue-number order: #13, #19, #17, #15, #23, #11, #14, #18,
   #16, #10, #21, #20, #12.

## Ground rules from these sessions

- Do not run `npm run pack`, reinstall, or reopen the app. Andria controls when
  the running app is replaced.
- Add new work as a GitHub issue, not as a bullet in CLAUDE.md.
- `npm run check` is the gate. Prettier is not part of it, and CLAUDE.md is not
  Prettier-formatted.
