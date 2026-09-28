# 🦊 den — project guide for Claude

Den is a **cozy personal cockpit for Claude-driven development**: one pastel,
pixel-art desktop app (Electron) where andria (senior dev @ runn) runs many
Claude Code sessions, each tied to its GitHub PR and Linear ticket, instead of
juggling terminal tabs. This file orients the next agent — read it first.

## Run / build

```bash
npm install            # postinstall: scripts/fix-pty.mjs restores node-pty's +x bit
npm run dev            # browser dev: server :4321 + Vite :5173 (open :5173)  ← fast loop
npm run app            # launch as an Electron app (rebuilds native for Electron first)
npm run pack           # build release/mac-arm64/Den.app (unsigned, local)
npm run typecheck
npm run lint           # eslint (flat config; non-type-checked)
npm test               # vitest (server + web pure logic)
npm run check          # typecheck + lint + test — run before committing
```

> **Don't repackage/reinstall unless andria explicitly asks.** Make changes,
> typecheck, verify, and commit — but leave the ship loop (`npm run pack` →
> `ditto` to `/Applications/Den.app` → reopen → `npm run rebuild:node`) for when
> they say so. They control when the running app is replaced.

**Native-module ABI gotcha (important):** `node-pty` and `better-sqlite3` are
native and must match the runtime. `npm run app` / `npm run pack` /
`electron-rebuild` build them for **Electron**; `npm run rebuild:node` builds
them for **Node** (needed by `npm run dev` / `npm run start`). Switch with those
two commands. The **installed `/Applications/Den.app` is self-contained** (its
own rebuilt modules), so it keeps working regardless of the project's ABI.

## Architecture

Node/TypeScript backend runs **inside** Electron's main process (also runnable
standalone via the CLI). Frontend is React + xterm.js. Terminals stream over a
WebSocket; everything else is REST.

- `electron/main.ts` — Electron entry; `fixPath()` pulls the login-shell PATH so
  a double-clicked app finds `claude`/`gh`; runs `startServer()` in-process,
  opens the window. Bundled to `dist/electron/main.cjs` by esbuild.
- `server/app.ts` — `startServer()` Fastify factory + **all routes** (sessions,
  fs browsing, GitHub, Linear, notepad, terminal WebSocket). Shared by CLI + app.
- `server/index.ts` — thin CLI wrapper over `startServer()`.
- `server/sessions.ts` — `SessionManager` + `DenSession`: owns long-lived PTYs
  (independent of any WS), 256KB scrollback ring (replays on attach), OSC
  title capture, attention (bell) flag, **workspace grouping** (groupId/role),
  and ticket/PR/look/view metadata. Spawns `claude -n <name> [flags] [prompt]`.
  `reviewInstruction` asks a review pane for **two** deliverables: the reading
  guide (`~/.den/review/<groupId>.guide.md`, grouped by purpose) and the review
  (the notepad, filed per file). **Every Claude pane gets a system prompt from
  one builder per kind**, shared by `create()` and `restartArgs` so a revived
  pane gets exactly what a fresh one did: `workspaceArgs` →
  `workspaceInstruction` (notepad + house rules) for a workspace main, and
  `singlePaneArgs` for the rest — `reviewArgs` for a review pane,
  `myPrInstruction` (which PR/repo/branch, act on pasted comments, draft
  replies here rather than posting) for a my-PR pane, `lookInstruction` for a
  look pane. **`houseRules()`** is appended to every pane that can commit or
  open a PR: plain ASCII in anything that leaves the machine, and **every PR
  opens as a draft** (`gh pr create --draft`, never `gh pr ready`). There is
  no deny backstop for the draft rule — permission patterns are prefix
  matches, so `Bash(gh pr create:*)` can't say "only with `--draft`" — so
  the instruction carries it alone. All of these are ASCII and unit-tested
  (`paneInstructions.test.ts`, `progressInstruction.test.ts`,
  `reviewInstruction.test.ts`). A new pane kind gets its own builder here,
  not a bare `-n name`.
- `server/store.ts` — `better-sqlite3` at `~/.den/den.db` (sessions + a settings
  table for the Linear key). Session rows are for the rail; live PTYs don't
  survive a restart (marked exited on boot). Rows carry a **`pos`** rail sort key
  (`ORDER BY pos, createdAt`) — `createdAt` by default, small indices once you
  drag the rail. Its backfill (`pos = createdAt`) runs **only on the boot that
  adds the column**: a dragged row legitimately holds pos 0, so an unguarded
  `WHERE pos = 0` backfill threw the saved order away every restart.
  Also holds each session's **scrollback**: the 256KB ring is flushed to a
  `scrollback` column (every 5s while dirty + on exit) and restored in
  `hydrate()`, so a restart replays recent output instead of an empty pane.
- `server/github.ts` — wraps the authed `gh` CLI: PR buckets (authored vs
  review-requested → `isMine`); the review bucket merges **two** searches —
  `--review-requested=@me` **and `--reviewed-by=@me`** — deduped before `enrich`
  (two `gh` calls per PR) and with your own PRs dropped, so a PR you've reviewed
  stays listed until it's merged or closed instead of vanishing the moment your
  review clears GitHub's request (`buildReviewBucket`, `reviewRequestedFromMe` /
  `reviewedByMe`); CI status from **`gh pr checks --json bucket`**
  (deduped to the latest run per check — *not* `statusCheckRollup`; see the CI
  gotcha below) summarized by `summarizeChecks`; `getPrDetail` (body + reviews + issue comments +
  **inline review comments** with `path`/`line`/`diffHunk` + a `resolved` flag,
  fetched via `gh api graphql` **reviewThreads** — the thread carries
  `isResolved`, which the REST comments endpoint omits, so the my-PR UI can hide
  resolved comments); and `getPrDiff`. (Two headless `claude -p` passes used to
  live here and are both **removed** — `summarizePrDiff` when the review diff's
  side column became the session's own per-file comments, and `reviewPr` /
  `POST /api/github/pr/review` once the interactive review session did the
  reviewing; its house-style rules live only in `reviewInstruction` now, so
  there's no second copy to drift. `discover.ts` still filters their old
  transcripts out of the resume list.)
- `server/linear.ts` — Linear GraphQL (`@linear/sdk` not used; raw fetch).
  Assigned issues + `branchName` + `description`. Key in the settings table or
  `LINEAR_API_KEY`. Scoped to whatever workspace the key belongs to (runn, for
  the maintainer).
- `server/git.ts` — `prepareWork` (ticket branch: worktree or local, off the
  repo's freshly fetched **base branch** — `baseRef` resolves it from the
  `base_branch` override (`$DEN_BASE_BRANCH` → the `base_branch` setting, via
  `baseBranchOverride()` in `fs.ts`), then `origin/HEAD`, then GitHub's default
  branch, then `master`/`main`, preferring `origin/<name>` over a stale local
  branch; pure `baseCandidates`/`pickBaseRef` are unit-tested. runn is based on
  **`development`**, so this matters: den used to branch runn tickets off
  `origin/master`), `checkoutPr` (`gh pr checkout` into a worktree or local),
  `worktreeForBranch` (reuse an existing worktree instead of erroring), and
  `listWorktrees` / pure `parseWorktrees` (every checkout of the work repo, its
  own working copy first — behind `GET /api/git/worktrees`, which the New
  Session dialog lists as "workspaces"). The branch-name rule lives in
  `shared/branch.ts` (re-exported as `isValidBranch`) so the dialog can reject a
  bad name without a second copy to drift.
- `server/discover.ts` — lists past Claude sessions from
  `~/.claude/projects/**/*.jsonl` (for resume). Titles each from its `summary`
  or first real user message; **drops** den's own headless `claude -p` helpers
  (PR review / diff-summary prompts) and empty/aborted sessions (no summary +
  no user prose), and scans past the limit to still fill it after skips.
- `server/fs.ts` — home-sandboxed directory browsing + `roots()`
  (documents / work / **workRepo** / projects). `workRepo` is the primary git
  repo that "Work" sessions and PR/ticket checkouts default into, resolved via
  `$DEN_WORK_DIR` → the `work_dir` setting → the sole git repo under
  `~/Documents/work` → `~/Documents/work` (see `workDir()`).
- `server/apprun.ts` — the workspace header's **"run this app locally"** button.
  `detectAppRunner(cwd)` walks up to the git root and picks a recipe: a runn
  checkout (`.runn/project.env` present) → `runn up`, with the app URL read from
  that file; else the first dev-ish npm script (`dev`/`start`/`develop`/`serve`/
  `turbo:dev`) → `<pm> run <script>`, the package manager sniffed from the
  lockfile. `appRunnerStatus()` adds liveness: `runn status` for runn (parsed by
  pure `parseRunnStatus`), a port probe for a script app. The port comes only
  from an **explicitly declared** `--port`/`-p`/`PORT=` in the script
  (`extractPort`) — guessing a tool default (5173, 3000) could probe an
  unrelated app and mislabel it "running". Behind `GET /api/app/runner` +
  `POST /api/app/run`; the POST **adds a shell tab** to the workspace and types
  `cd <repo> && <command>` into it rather than running the command itself, so
  the output is in front of you and Ctrl-C works. The command is written **400ms
  after** the tab opens — a fresh login shell eats keystrokes typed during zsh's
  prompt init. `web/src/AppRunButton.tsx` renders "▶ run <name>" or, when it can
  tell the app is already up, "▶ open <name>" linking to the URL. Pure parts
  unit-tested in `server/apprun.test.ts`.
- `web/src/App.tsx` — the UI's composition root: 3-column flex layout, topbar
  (fox + shortcuts popover), the center-pane switch (terminal / 3-pane claude
  workspace / look / PR review / my-PR), and the ticket/PR open-session flows +
  dialogs. The pieces it used to hold inline now live in their own modules:
  session state + CRUD in `useSessions.ts` (the list, selection, shell-tab map,
  and the 4s merge-only poll — anything that creates a session out-of-band must
  refetch the full list, which the hook's mutators do), the rail in
  `SessionRail.tsx`, ticket/PR chips in `WorkLinkChips.tsx`, and the ticket-look
  layout in `TicketLookView.tsx`.
- `web/src/WorkData.tsx` — **single source of truth** for GitHub PRs + Linear
  issues. A `WorkDataProvider` (mounted in `main.tsx`) polls each endpoint **once**
  (60s) and shares it via `useWorkData()`; App (fox + linking), `WorkPanel`, and
  `LinearSection` all read from it, so they never drift out of phase. Previously
  each polled independently (four loops for two resources).
- `web/src/` hooks/helpers extracted from App: `useSessions` (session list +
  mutations + poll), `useRovingFocus` (arrow-key focus ring),
  `useKeyboardShortcuts` (Cmd/Ctrl+N/T/W/1–9), `useNotifications` (native
  OS notifications on attention/PR transitions), `usePersistent.ts` (the
  localStorage-backed number/string/JSON hooks), `foxPose.ts` (pure
  `deriveFoxPose` + the pose cast/titles), `format.ts` (relTime/relTimeAgo,
  card accentStyle, prKey), `reorder.ts` (pure `moveItem` / `sortByGroupOrder`
  for the rail drag — the server mirrors it in `reorderPositions`),
  `TerminalView`, `TicketComments`, `api.ts` (the
  fetch wrapper — use it for every REST call so non-2xx surfaces as a throw;
  the one deliberate exception is WorkData's `refreshIssues`, which needs the
  raw 409 = "no Linear key"). Each is small and unit-testable where pure.
- `web/src/` components: `SessionRail` (the left column), `WorkLinkChips`
  (ticket/PR chips — explicit link wins, branch hint is the fallback),
  `TicketLookView` (ticket detail + Claude pane), `WorkPanel` (Linear + GitHub
  cards), `LinearPanel`, `TicketDialog`, `PrDialog`, `PrViews`
  (PrReviewView/PrMyView), `DiffView`, `NotepadPane`, `NewSessionDialog`,
  `Fox`/`foxSprites` + `PixelFox`, `Splitter` (divider + `clamp`),
  `useTerminal`, `markdown.ts` (line-oriented mini-renderer; a **soft line break
  continues its paragraph or `<li>`** instead of starting a new block, because
  the review and its guide are hard-wrapped prose — `NEW_BLOCK` keeps a numbered
  list from being swallowed; `markdown.test.ts`), `theme.css`. `shared/colors.ts` holds the
  9-pastel palette both the server (auto-assign) and the picker import.
  - `DiffView.tsx` exports `classify(line)` (diff-line CSS class), `DiffHunk`
    (renders one `diff_hunk`, marks the anchored last line), `lineNumbers(lines)`
    (old/new file line numbers walked from each `@@ -a,b +c,d @@` header — only
    *inside* a hunk, since the `---`/`+++` preamble also starts with `-`/`+`), and
    `diffFiles(diff)` (the paths a diff touches — the keys review comments are
    filed under), `diffForFiles(diff, files)` (the sub-diff for just those
    files, in the order given — how the Guide tab renders one section), besides
    `DiffView` (per-file blocks: the review's comments for
    that file in a sticky left column, diff right). Every line renders a two-column
    number gutter (`.diff-gutter`, old then new) so a review saying "line 448" can
    be found in the diff; the gutter is `position: sticky; left: 0` and repaints
    the row's tint, so numbers survive scrolling a wide line sideways.
  - `reviewNotes.ts` — pure `parseReview(md, files)` → `{ overall, byFile }`:
    splits the review markdown a review session writes to its notepad into the
    general review plus per-file sections, keyed by `## <path>` headings. Matching
    is forgiving (backticks, shortened paths, trailing prose, fenced `#` lines);
    unit-tested in `reviewNotes.test.ts`. **A heading that fails to match falls
    into the previous file's column** — the failure mode to watch. Two guards:
    only *matched* emphasis pairs are stripped (`stripEmphasis`), because stripping
    `_` wholesale broke every snake_case path (`query_notification_subscriptions.test.ts`);
    and a heading that `looksLikePath` but matches no file in the diff ends the
    current section and is appended to `overall` instead of misfiling.
  - `reviewGuide.ts` + `PrGuide.tsx` — the **Guide tab**: the PR read in the
    order it was *written*, not file-alphabetical order (den's take on Linear's
    diff guides). The review session writes a reading guide to
    `~/.den/review/<groupId>.guide.md` — a short intro, then one
    `## <section title>` per group of related changes (core implementation
    first, churn last), each with two to four lines on its purpose and impact
    and a `Files: a.ts, b.ts` line. Pure `parseGuide(md, files)` →
    `{ intro, sections: [{title, body, files}], leftover }`; `PrGuideTab`
    renders each section's prose above **that section's own diffs**
    (`diffForFiles` in `DiffView.tsx` slices the diff per section), with the
    review's per-file comments still beside each file. Parsing is forgiving the
    same way `reviewNotes.ts` is and reuses its `matchFile`/`looksLikePath`:
    bulleted or comma-separated paths, `Paths:` as the label, a shortened path,
    a heading that is itself a path (a one-file section), backticked paths in
    the prose as a fallback. **The first section to claim a file keeps it**, so
    no diff renders twice, and `leftover` (files no section grouped, or the
    whole diff before a guide exists) goes in a collapsed `<details>` at the
    bottom — nothing is ever hidden. Unit-tested in `reviewGuide.test.ts`.
    Why its own file and not the notepad: the review's `## <path>` headings and
    the guide's `## <section title>` ones would otherwise share a parser.
  - `PrViews.tsx`: `PrReviewView` (others' PRs — **two regions, one splitter**, so
    it works on a small screen: a tabbed pane above (**Guide** / **Review** /
    **Description**) and the session below. The Review tab is one scroll region — the general review
    first, then the diff with **each file's review comments beside that file's
    hunks** (sticky, via `parseReview` → `DiffView notes=`). The session is told
    (via `reviewInstruction`) to save its finished review as markdown to the
    workspace notepad `~/.den/progress/<groupId>.md`, structured as general review
    then one `## <file path>` heading per file; the view polls that notepad, so the
    review is shown next to the code it's about *and* kept as a record.
    **The review's house style is part of that instruction**, because andria
    copies the comments straight into GitHub: **plain ASCII only** (no em dash,
    curly quote, arrow, ellipsis char or emoji — they survive a paste as
    mojibake or break a code span), and **short ranked bullets** (one issue per
    bullet, `path:line` first, then problem then fix, max 5 per file, worst
    first, no praise/preamble/recap). Those bullet rules are Claude Code's
    built-in **Concise** output style plus the **`i-have-adhd`** skill, the two
    andria runs — including Concise's *"while doing the work just as
    thoroughly"* clause, which is load-bearing: the **writing** is terse, the
    review is not. Don't let the 5-bullet cap become a reading cap.
    **The finding pass runs through Claude Code's built-in `code-review`
    skill** (adversarially verified findings), which `reviewInstruction` tells
    the session to run at high effort against the PR's branch before writing
    the notepad — with `--comment` (posts to GitHub) and `--fix` (edits the
    working tree) explicitly forbidden, and the notepad review still the
    deliverable (the skill's report renders only in the terminal). The skill
    is a first pass, not the review: the instruction says to also cover what
    its correctness/simplification scope misses. The review paste prompt
    (`reviewPrompt` in `web/src/prompts.ts`) names the skill too so the two
    don't drift. Verified live
    2026-08-22: a den-spawned review session lists the skill and invokes it
    (it runs as a background agent); note its shell commands surface as the
    review pane's normal permission prompts, so a review still needs the
    developer around to approve reads.
    The instruction string is itself written
    in ASCII — an instruction full of em dashes teaches the model to write
    them back — and `reviewInstruction.test.ts` asserts that with `isAscii`
    (`shared/ascii.ts`). The client prompts (`guidePrompt`, `reviewPrompt`,
    `autoReviewPrompt`, `fileReviewPrompt`, `notePrompt`, and the ticket
    flow's `ticketPrompt` / `ticketNotesSeed` and the self-edit `denPrompt`)
    live in the pure `web/src/prompts.ts` for the same reason, and
    `prompts.test.ts` holds each to the same check. `progressInstruction`
    (every workspace main pane) is ASCII too, tested in
    `progressInstruction.test.ts`, and tells a session to read its notepad
    before starting, since a restart doesn't re-inject the initial prompt.
    **Put any new client prompt in `prompts.ts`, not inline in a component.** `fileReviewPrompt` (the per-file
    "→ review" button) names the file and its hunk ranges instead of
    re-pasting them (the diff is already on disk), and tells the pane to answer
    in the terminal; `reviewInstruction` says the same about follow-up
    questions in general, so a one-file ask can't overwrite the finished review.
    (`reviewInstruction` is the only copy of these rules — the headless
    `reviewPr` duplicate was removed 2026-08-25.)
    Review panes carry a notepad **and a guide file** — `create()`/`restartArgs`
    wire both for `view === "review"`, and `remove()` deletes them with the diff
    and settings file when the workspace closes. **A review pane has a full shell** (running the tests or
    trying a fix is part of reviewing) but **must never commit or push** — see
    Security posture for the instruction + deny backstop that holds that line. den
    still fetches the diff (`app.ts`) into `~/.den/review/<groupId>.diff` so the
    whole change is in front of the session without a round-trip);
    `PrMyView` (your PRs — description, top-level `Notes`, and
    `InlineComments`: line-level comments grouped by file, each shown with its
    diff hunk — **resolved threads are hidden by default** behind a "show N
    resolved" toggle so the tab focuses on what still needs action); `ToClaude`
    button pastes a framed instruction into the session. The tab you're on
    (Description&comments / Inline) persists via `usePersistentString`.

## Data model

A **session** = one PTY (`DenSession`) with `groupId` + `role` ("main"|"shell").
- **Claude workspace** = a `main` claude pane + **one or more `shell` panes**
  (same group, shown as tabs) + a progress notepad at `~/.den/progress/<groupId>.md`.
  The notepad is scoped to the workspace: kept across exit/restart, but **deleted
  when the workspace is closed** (`remove()`), so `~/.den/progress` doesn't fill
  with orphans. (The "edit den" workspace seeds it empty — its handover lives in
  the initial Claude prompt, not the notepad.)
- **shell** session = a single plain terminal.
- **Single-pane claude** sessions carry a `view`: `look` (ticket + claude),
  `review` (others' PR), `mypr` (your PR), or a ticket-look. They also carry
  `ticket` / `pr` / `prRepo` / `branch` for linking. A **look** pane saves the
  ticket (`ticketBrief`, sent as `notepadSeed`) to the group's notepad path so
  `lookInstruction` can point the session at it — the same file on restart,
  deleted by `remove()`. It's a reference file, not a progress log, and the
  look layout doesn't render it. A **my-PR** pane has no notepad (its layout
  has nowhere to show one; the PR's commits are the record).
The rail shows only `role === "main"`. The frontend polls `/api/sessions` (~4s)
to sync names/status/attention — the poll **only merges existing rows, never
adds new ones**, so any code that creates a session out-of-band must refetch the
full list itself (see `addSession` / `addShellTab`). Session context
(`branch`/`ticket`/`look`/`view`/`pr`/`prRepo`/`titleLocked`) persists in
`store.ts` and restores in `hydrate()`, so the rail keeps full context across a
server restart (sessions come back `exited` but their center pane is intact).

Extra shell tabs: `sessions.addShell(groupId)` (route `POST /api/sessions/:id/shell`)
adds a shell-role pane to a group; `removeOne(id)` (route `DELETE …?scope=one`)
closes a single pane, refusing "main". The frontend tracks the active tab per
group in a `shellTab` map.

Restarting exited sessions: `sessions.restart(id)` (route `POST /api/sessions/:id/restart`)
re-spawns an exited session's PTY in place, keeping its cwd/name/colour/branch/
ticket/PR context. Claude args are **rebuilt** from the persisted context
(`restartArgs`, via the same `workspaceArgs` / `singlePaneArgs` builders
`create()` uses, so every pane keeps its system prompt), so restart never re-injects the one-time initial
prompt, and it works even after a server restart wiped the in-memory `spawnArgs`.
The scrollback is cleared (fresh process). The frontend keys each `TerminalView`
by `` `${id}:${status}` `` so the flip to "running" remounts it and reconnects to
the new PTY; restart buttons (`↻`) appear on exited rail rows + in the workspace
header. This is the answer to "live PTYs don't survive a restart" — the row comes
back exited, and one click revives it.

## Features (all built + committed on `master`)

- Multi-session cockpit: create/rename(double-click)/recolour/close; persistent;
  scrollback-on-switch; attach-by-id WebSocket.
- **Reorderable rail**: drag a session row to move it (or **alt+↑/↓** on a
  focused row — plain arrows belong to the roving focus ring). The order is the
  workspace order: `POST /api/sessions/reorder` takes `groupIds` top to bottom,
  `sessions.reorder` gives every pane of a workspace its workspace's `pos` (so
  shell tabs travel with their main pane), and it persists, so a restart brings
  the rail back the way you arranged it. New sessions land at the end.
  The drop indicator is a `::before`/`::after` line, **not** a `box-shadow` — a
  shadow follows the row's border radius and reads as a ring, not an insertion
  point.
- New Session dialog: **Work / Personal / Other / Resume** with a folder browser
  (create folders, type paths). Sessions default to `~/Documents`.
- **Work asks which workspace** (= one checkout of the work repo): *existing*
  lists every `git worktree` (the repo's own checkout tagged "main checkout",
  each row branch + path) and opens the session there; *new* takes a branch name
  and creates the worktree via the same `prepareWork` the ticket flow uses, so
  an existing branch reuses its worktree rather than duplicating it. "Browse
  folders instead" keeps the old free-browsing path, and a work dir that isn't a
  git repo drops straight to it.
- Claude workspace = **main + shell + progress notepad**; notepad renders
  markdown, is editable/savable; the main Claude is told to log progress to it.
- **Resizable** panels (draggable splitters, sizes persisted to localStorage).
- Session **titles**: Claude auto-titles via OSC (shells don't); manual rename
  locks it; the **topbar tints to the active session's colour + shows its title**.
- **Reactive pixel-art fox**: topbar status fox — `alert` when something needs
  *your* action: a PR needing you (authored PR failing CI / changes requested, or
  a review you owe) **or unread Linear notifications**. A PR you're *reviewing*
  failing its CI does NOT alert, and a review-requested PR that's **already
  approved** no longer alerts. The pose is derived (in `App.tsx`) from three
  inputs — `prNeedsMe` + `prCount` + `linearNotifs` — not set inline. Else `happy`
  (open PRs) / `sit` (none). Sleeping fox in the empty state; walking fox in
  loading rows (`.loading-row`) — PR/Linear fetches, and the PR review while
  Claude is writing it. That last one is gated on a review having actually been
  *requested* (`requested` in `PrReviewView`, set by the auto-paste or the "review
  in session" button), not on the notepad being empty: an empty notepad usually
  just means nobody asked yet, and a fox walking then would be a lie.
  Sprites in `foxSprites.ts`; keep integer scale + stepped animation
  or they blur. **Click the status fox** for a popover showing all five poses
  (current one badged "now") plus a link to the architecture map
  (`web/public/architecture.svg` — served by the app at `/architecture.svg`,
  embedded in the README, and drawn by hand: update it when the architecture
  changes); **hover the `den` wordmark** for the keyboard-shortcut cheat sheet.
- **PR cards flag what needs you**: cards with `needsAttention` get a pink accent
  + pulsing `!` (tooltip = `attentionReason`), so the "review requested" and "my
  open PRs" sections show at a glance which ones are on you. Drafts and
  already-approved review-requested PRs drop the flag.
- **"Review requested" keeps what you've reviewed** until the PR is merged or
  closed — reviewing one used to clear GitHub's review request and make the card
  disappear mid-flight. The `!` follows the *open review request*
  (`reviewRequestedFromMe`, `reviewAttention`): submitting a review silences it
  (a quiet dashed `✓ reviewed` badge says why the card is still there), and a
  re-request brings the `!` back with "a re-review is requested". PRs still
  waiting on you sort to the top of the bucket.
- **Keyboard shortcuts**: `Cmd/Ctrl+N` new claude · `Cmd/Ctrl+T` new shell ·
  `Cmd/Ctrl+1–9` switch to the Nth rail session · `Cmd/Ctrl+W` close active
  (native Cmd+W freed via a trimmed Electron menu in `main.ts`).
- **Arrow-key roving focus**: arrows move a visible `.roving-focus` ring across
  rail sessions → center pane → work cards; Up/Down within a column, Left/Right
  between; Enter activates (dives into the terminal for the center pane); Escape
  leaves a terminal/input back to the rail. Bails while focus is in a
  terminal/text field (never hijacks typing); a mouse click clears the ring.
- **Multiple terminal tabs per workspace**: the shell pane is a tab strip — `+`
  opens another shell in the same workspace, `×` closes one (shown only when >1).
- **Run the app you're working on**: the workspace header has a ▶ button
  (`AppRunButton`) when den can tell how to start the repo — `runn up` for a runn
  checkout, else its dev-ish npm script. It opens a **new shell tab** in the same
  workspace and types the command there, so you watch it boot and Ctrl-C it like
  normal. When it can tell the app is already up (runn status / a port probe) the
  button becomes ▶ open and links to the URL instead. See `server/apprun.ts`.
- **Edit den itself**: the far-left topbar pixel fox is a button (`openDenEditor`)
  that opens a normal 3-pane Claude workspace rooted in den's own source
  (`denRepo()` in `fs.ts` → `roots().den`), notepad seeded with a handover +
  Claude primed to read CLAUDE.md. Race-safe reuse via the sentinel ticket
  `"den:self-edit"` (one editor at a time). The app/dock icon is the same pixel
  fox (`scripts/make-icon.cjs` → `build/icon.png` → `icon.icns`).
- **Work panel**: Linear tickets + GitHub PRs, with ↗ open-in-browser links.
- **Session ↔ branch ↔ ticket ↔ PR linking**: chips in the workspace header and
  on rail cards (matched via the `fast-NNNN` branch hint + explicit ids).
- **Colour-linked work cards**: a work-panel card whose ticket/PR has a live
  session is tinted with that session's colour (left stripe + faint wash), so you
  can tell at a glance which cards and sessions are related. App.tsx computes
  `ticketColor`/`prColor` (running sessions win over exited) and passes them to
  `WorkPanel` → `Section`/`PrCard` + `LinearSection`/`IssueCard`.
- **Resume** past Claude sessions from `~/.claude/projects` — each titled by its
  summary / first real message, with den's headless helpers and empty sessions
  filtered out.
- **Attention nudges**: a background session that rings the bell shows a pulsing
  `!`; cleared when you view it.
- **Linear ticket → Look / Work**. Work creates the branch (worktree or local),
  seeds the notepad with a ticket summary, and **primes Claude** with the ticket
  to explain the issue + propose a solution before coding. Look = ticket detail
  with **Description / Comments tabs** (`TicketLookView`) + a Claude pane; comments
  via `getIssueComments` → `/api/linear/comments` (bot/integration comments show
  their `botActor` name).
- **Linear notifications nudge**: `getAssignedIssues` also returns
  `unreadNotifications` (same GraphQL query); a pink `! N` badge shows in the work
  panel's linear header (links to the workspace inbox) and unread notifications
  push the topbar fox to `alert`.
- **GitHub PR → Review / Edit**. Others' PRs: check out into a worktree, then
  **one tabbed pane above (Guide / Review / Description) + the Claude session
  below** —
  two regions, one splitter (it used to be four panes and three splitters, which
  didn't fit a small screen). The Review tab reads top-to-bottom: the general
  review, then the diff per file with **that file's review comments in the column
  beside its hunks** (sticky, so they stay put while you scroll the code). Your
  PRs: description + colleagues' reviews/comments + a Claude session on the
  branch. Sessions are named `FAST-1234: title` / `PR #123: title`.
- **Reading guide for a PR** (the Guide tab, den's take on Linear's diff
  guides): instead of the diff in file-alphabetical order, the session groups
  the change into sections — the core of the implementation first, supporting
  changes next, churn (lockfiles, generated files, formatting) last — writes
  two to four lines on each group's purpose and impact, and den renders that
  explanation above **that group's own diffs**. It lands before the review does,
  so there's something to read while the finding pass runs. Anything the guide
  doesn't group sits in a collapsed block at the bottom, so no change is hidden.
  Guide and review are separate asks: `build guide` on the Guide tab, `review in
  session` on the Review tab; the auto pre-review asks for both, guide first.
- **Inline comments → Claude** (your PRs). The my-PR info pane has **two tabs**
  (`PrMyView`): *Description & comments* (description + top-level reviews/comments)
  and *Inline comments* — line-level review comments grouped by file, each rendered
  **with the diff hunk it points at** (anchored line marked) so you see the code
  it's about. Every review / comment / inline comment has a **"→ Claude"** button
  that pastes a framed instruction (author, `file:line`, body, diff hunk) into
  the session's Claude prompt via `POST /api/sessions/:id/paste` (bracketed
  paste — keeps multi-line as one entry, does **not** auto-submit: you read it,
  then press Enter).
- **`submit: true` on the paste route** = press Enter too, for the actions that
  mean "do this now": the "Have Claude pre-review the diff" option and the "review
  in session" button, which used to need a second click in the terminal. Three
  things make it safe/reliable, all worth keeping:
  1. The CR is written by the server, never carried in `text` — `sanitizePaste`
     strips CR from content, so a PR comment can't submit itself (tested).
  2. It's a **separate write ~250ms after** the paste (`PASTE_SUBMIT_DELAY_MS`):
     Claude's TUI ingests a paste asynchronously and an Enter in the same chunk can
     beat the input box.
  3. A submit first **waits for the pane to be ready** (`waitUntilIdle` /
     `ptyLooksIdle` in `sessions.ts`: output seen, then quiet ~800ms). A freshly
     spawned Claude *silently drops* input while it's drawing — measured on a real
     session, a paste at 6s vanished and the same paste at 12s landed — so the old
     fixed 2s client delay was a coin flip. Verified: paste fired 0ms after spawn,
     server held 1.4s, prompt landed and Claude answered.
  Auto pre-review fires once: `PrReviewView` calls `onAutoReviewStarted` so App
  clears `autoReviewPr`, otherwise revisiting the session re-ran the whole review.
- **Colour picker**: the workspace-header colour is a single dot button that pops
  the swatch list on click (was always-on swatches eating header space). The
  topbar title chip sizes to its content, ellipsis only on overflow.
- **Reuse everywhere**: clicking a ticket/PR reuses an existing session; branches
  and worktrees (incl. Claude Code's own `.claude/worktrees/`) are reused, never
  duplicated. Error toasts surface any failure.
- **Electron app** with a rendered fox `.icns`.

## Conventions & gotchas (hard-won)

- **Pixel art**: render via canvas + `image-rendering: pixelated` at an *integer*
  pixel scale; animate with `steps()` (fractional transforms/offsets blur it).
- **xterm FitAddon + padding**: never put padding on the element xterm is opened
  into (the one FitAddon measures). FitAddon reads `getComputedStyle(host).height`,
  which under `box-sizing:border-box` *includes* padding, so it fits one row too
  many and `overflow:hidden` clips the last line. Padding/background/rounding live
  on `.term-host-wrap`; the inner `.term-host` (fit target) stays padding-free.
- **OSC titles**: parsed only for claude panes (shells retitle to cwd/command and
  flap). Ticket/PR sessions lock the title so it stays descriptive.
- **CI status must come from `gh pr checks`, never `statusCheckRollup`.** The
  rollup lists *every* check run, including **superseded** ones, so a check that
  was re-run and went green still carries its old `FAILURE` row and the PR reads
  as failing forever (hit on Runn-Fast/runn#20662: 116 rollup rows vs 99 real
  checks, one stale "Validate PR title" failure; it also inflated pass counts,
  e.g. 81 of 100 rows where the truth was 79). It's additionally capped at ~100
  contexts and runn PRs sit at 96–98, so bigger PRs would silently drop checks.
  `gh pr checks --json bucket` is deduped to the latest run per check and
  uncapped. Gotcha: it uses its **exit code as a status** (1 failing, 8 pending)
  while still printing the `--json` payload, so it's called via `ghAllowFail`,
  which recovers `err.stdout` instead of throwing. A PR with no CI at all exits 1
  with an *empty* payload and "no checks reported" on stderr — that's a
  legitimate `none`; any *other* empty payload logs a warning so a future `gh`
  behaviour change surfaces instead of silently reading as "no checks".
- **git commits sign via 1Password** (`commit.gpgsign=true`, ssh). If it's locked
  the commit fails with "1Password: failed to fill whole buffer" — retry when
  unlocked, or `--no-gpg-sign` and re-sign later. Commit trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **work repo** = the configurable primary repo (`workDir()`, default: the sole
  git repo under `~/Documents/work`; the maintainer's is `runn`). It has its own
  Claude rules/setup — always work inside it or a worktree of it for Linear/PR work.

### Security posture (server is loopback-only)
The server can spawn shells and touch files under `$HOME`, so it is treated as a
local control plane, not a public API:
- **`server/security.ts`** — an `onRequest` hook rejects any request whose `Host`
  isn't loopback (blocks DNS-rebinding) or whose `Origin`, when present, isn't
  loopback (blocks cross-site WebSocket/fetch hijacking). Applies to REST **and**
  the terminal WS upgrade. Missing `Origin` (non-browser / navigations) is allowed.
- Shell-outs use `execFile`/`spawn` with **arg arrays** (never a shell string);
  `git.ts` validates branch names (`isValidBranch`) so a leading dash can't be
  read as a flag; `fs.ts` `within()` realpaths the nearest existing ancestor so a
  symlink inside `$HOME` can't escape it; notepad `groupId` is validated
  (`isValidGroupId`) against traversal.
- **PR-review panes: full shell, but never commit or push.** Reviewing someone
  else's PR properly means running their tests, bisecting a suspicion, trying a
  fix — so a `view === "review"` pane is a normal Claude session with a shell.
  (It was strictly read-only, `deny: ["Bash", Edit(worktree)]`, until 2026-08-13;
  that made real review work impossible. Don't reintroduce the Bash deny.) What
  holds the line now is two layers:
  1. **The instruction** (`reviewInstruction` in `sessions.ts`) — the primary
     guard, and the one to edit if the rules change: never commit, never push,
     never post to GitHub, and any file change goes on a local scratch branch
     `andria/changes-to-<pr branch>` (`scratchBranch`), left uncommitted, so the
     PR's own branch is never the one carrying den's edits.
  2. **A deny backstop** in the generated per-session settings file
     (`--settings`, `--permission-mode default`; `buildReviewPermissions`,
     unit-tested): `Bash(git push:*)`, `Bash(git commit:*)`, the writing `gh pr`
     subcommands (`merge`/`review`/`comment`/`edit`/`close`/`reopen`/`ready`/`create`),
     `gh issue comment`, and `gh api`. A `deny` can't be prompted past, and
     `gh pr view|diff|checks` stay open for reading. It is a backstop, **not** a
     sandbox: a shell can still reach those places another way (`git -C`, a
     wrapper script, an alias), which is why the instruction carries the weight.
  The `allow` list is the notepad and the guide file (`Edit(//<notepad>)`,
  `Edit(//<guide>)`, so the finished review and its reading guide save without a
  prompt) plus the reads a review runs constantly — `git
  log/show/diff/status/blame/grep/fetch`, `rg`/`grep`, `gh pr view|diff|checks`
  — so the code-review skill's finding pass doesn't stall on a prompt per
  `git show` (deny beats allow, so the write backstop is untouched); everything
  else prompts as usual. The diff is still
  handed over as a file (`~/.den/review/<groupId>.diff`) so the whole change is
  in front of the session immediately.
- The Linear key lives only in `~/.den/den.db` (gitignored) or `$LINEAR_API_KEY`;
  it's never returned to the client or logged. Errors are sanitized before
  reaching the client (`server/log.ts` `logWarn` keeps details server-side).
- Electron: `sandbox:true`, `contextIsolation:true`, navigation pinned to the app
  origin, and only `http(s)` URLs reach `shell.openExternal`.

### Verifying changes (how this project has been tested)
`npm run check` (typecheck + eslint + vitest) is the automated gate. **Tests**
live next to their source as `*.test.ts` (`server/*.test.ts`, `web/*.test.ts`)
and cover the pure, rule-heavy logic — the loopback guard, PR attention rules,
branch validation, path sandbox, title tidy, fox pose. Keep new pure logic
testable (export it) and add a case. Beyond that, verification is scripted + visual:
- Run an **isolated** server: `DEN_DB=<tmp> PORT=4399 npm run start` (node ABI).
- Screenshot the UI by loading the URL in a headless Electron window and calling
  `webContents.capturePage()` (see `scripts/shot.cjs`): `SHOT_URL=... SHOT_OUT=x.png
  npx electron scripts/shot.cjs`, then **read the PNG back to eyeball it**. Keep
  window width so the 2× capture stays < 2000px to avoid downscaling (blurs pixels).
- **Cheap CSS/layout check** (used a lot): write a static HTML into the scratchpad
  that `<link>`s the real `web/src/theme.css` (via `file://`) and hand-builds the
  component's DOM with representative data, then `shot.cjs` it. Avoids the full
  worktree + headless-Claude cost when you only need to verify styling/layout.
- **Driving the live app** (for interaction, not just layout): run `npm run dev`
  (node ABI), then a throwaway Electron script that `loadURL`s `:5173` and
  `executeJavaScript`s clicks / `fetch`es, reading back DOM state. Gotcha:
  **synthetic `dispatchEvent` keyboard events are untrusted** — they won't trigger
  `:focus-visible` or the browser's keyboard modality. Use
  `webContents.sendInputEvent({type:"keyDown",keyCode:"Down"})` for a trusted key,
  or (as the arrow-nav does) drive focus with an explicit class instead of relying
  on `:focus-visible`.
- Verify data/endpoints against **real** PRs/tickets (e.g. `getPrDetail`,
  `getPrDiff`, the paste endpoint) with a short Node fetch script on an
  isolated server — separate from the visual layout check above.
- In this sandbox, spawning Electron/`gh`/`claude`/git needs
  `dangerouslyDisableSandbox: true`.
- **zsh chokes on UUIDs** in `$(...)` (bad-math errors) — do multi-step API tests
  in a Node script, not inline bash.
- Never test git flows against the real runn repo without cleanup; prefer a temp
  repo under `~` (the fs cwd sandbox rejects `/tmp`). Set `commit.gpgsign false`
  in temp repos or commits hang on 1Password.

## Backlog

**The backlog lives in GitHub issues**, not here:
<https://github.com/andria-hibe/den/issues>. This section used to hold a
13-item roadmap that mixed open work with items marked done, and it drifted —
the app-runner feature above shipped without ever reaching it. Everything open
on 2026-09-16 was filed as an issue; anything finished was folded into
Architecture and Features above. **Add new work as an issue, not as a bullet
here.**

A session handover with the current state of that backlog lives in
`docs/handover.md` (delete it once issues 1-8 are closed on GitHub).

Worth knowing before you touch the session code:

- **Issues 1-8** (fixed 2026-09-28) were one bug in different places: the
  prompts den injects disagreed about ASCII, about where a session should
  write its answer, and about what a restarted, my-PR, or look pane knows.
  The fix is the pattern to keep: every server instruction comes from one
  builder shared by create + restart, every client prompt lives in
  `web/src/prompts.ts`, and a test asserts each is ASCII.
- **Issue 22** (base branch): new branches come off the repo's resolved base
  branch (see `baseRef` under Architecture), and a review pane's scratch branch
  is told to start from the PR's checked-out code. Still open: stacking a
  ticket on the branch of the ticket before it, which needs ticket order den
  doesn't have yet.

Full narrative history is in the git log; user-facing run notes in `README.md`.
