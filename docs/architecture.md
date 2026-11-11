# den: architecture and feature notes

The long-form notes behind CLAUDE.md: how each part works, why, and what was
verified. CLAUDE.md is the short index every session loads; read the section
here for the area you're changing, and keep it current when you change it.

## Run / build

```bash
npm install            # postinstall: scripts/fix-pty.mjs restores node-pty's +x bit
npm run dev            # browser dev: server :4321 + Vite :5173 (open :5173)  ← fast loop
npm run app            # launch as an Electron app (builds native/ for Electron first, once)
npm run pack           # build release/mac-arm64/Den.app (unsigned, local)
npm run typecheck
npm run lint           # eslint (flat config; non-type-checked)
npm test               # vitest (server + web pure logic)
npm run check          # typecheck + lint + test — run before committing
npm run smoke          # end-to-end: real server + UI in headless Electron (node ABI)
```

> **Update den** (topbar "⬆ update", `UpdateButton` + `server/denUpdate.ts`):
> the installed app knows the commit it was built from (`DEN_BUILD_COMMIT`,
> stamped by `scripts/build-electron.mjs`; empty for a dirty tree) and
> offers the checkout's newer commits. "build" runs `npm run pack` in the
> checkout (refused while it has uncommitted changes) and stages
> `/Applications/Den.app.new`; "quit and install" runs
> `scripts/install-den.sh` (with `DEN_INSTALL_NO_QUIT`), which detaches and
> waits, then den quits itself (`StartOptions.quit`, Electron's `app.quit`;
> not AppleScript from a process den started) and the script swaps and
> reopens. Refused mid Hedgehog round or idle handover, and unless the
> staged build (`update-staged.txt`) is the checkout's HEAD. Both are the developer's clicks, so the rule
> below still holds for sessions.
>
> **Don't repackage/reinstall unless andria explicitly asks.** Make changes,
> typecheck, verify, and commit — but leave the ship loop (`npm run pack` →
> staged copy into `/Applications/Den.app` → reopen) for when they say so. They
> control when the running app is replaced. **Only replace the bundle while
> den is quit.** A running den execs node-pty's `spawn-helper` by its path in
> the bundle on every new terminal, so moving or deleting the bundle under it
> (as a staged swap did, 2026-10-30) leaves existing panes running but makes
> every new session and restart exit at once with no output.

**Native modules: no more switching** (issue 20). `node_modules` is always
built for **Node**, so `npm run dev`, `npm test`, and `npm run smoke` work at
any time, including right after `npm run app` or `npm run pack`. Only
`better-sqlite3` is runtime-specific (V8 ABI); `node-pty` is on N-API and its
one binary loads in both. So `npm run native:electron`
(`scripts/native-electron.mjs`, run by `app`/`pack`/`dist`, skipped when up to
date) builds an **Electron copy** of `better_sqlite3.node` into
`native/electron-<version>/` — with `node-gyp` against Electron's headers, on a
copy of the package in a temp dir, **not** `electron-rebuild` (it walks up the
tree and rebuilds `node_modules` in place too). `sqliteBinding()`
(`server/nativeBinding.ts`) hands that file to better-sqlite3 as
`nativeBinding` under Electron (packaged: `app.asar.unpacked/native/…`; dev:
`<cwd>/native/…`), and `electron-builder.yml` ships `native/` unpacked with
`npmRebuild: false`. A mismatch left anyway (an old checkout, a manual
rebuild) fails with a message naming the command to run (`openDb` in
`store.ts`). `npm run rebuild:node` remains only as a repair. The installed
`/Applications/Den.app` is self-contained either way.

## den v2, and the Burrow detour

den v2 (Fox, the crew, Today, clock out) was first built on 2026-10-29 as a
second app, **Burrow**, beside den v1, with its data in `~/.burrow`; andria
moved to it the same day, then asked for the den name back once v1 was gone.
The edition split is removed: there is one app, den, with v2 always on, its
data in `~/.den` (`server/dataDir.ts`; `DEN_DATA_DIR` overrides it for test
servers), and the fox head (`PixelFox`) as its icon (`scripts/make-icon.cjs`
+ `iconutil`, on the original pink-to-sky gradient) and topbar logo. `electron/adoptBurrow.ts`, imported **first** in `main.ts` so it
runs before the store opens a file, moves `~/.burrow` to `~/.den` on the
packaged app's first start and keeps v1's data as `~/.den-v1`; while a
`Burrow` process runs it does nothing and `boot()` asks for Burrow to be quit.
**Never run that move from server code**: a test run that imported an
earlier version of it renamed the real data dirs under a running Burrow.

## Architecture

Node/TypeScript backend runs **inside** Electron's main process (also runnable
standalone via the CLI). Frontend is React + xterm.js. Terminals stream over a
WebSocket; everything else is REST.

- `electron/main.ts` — Electron entry; `fixPath()` pulls the login-shell PATH so
  a double-clicked app finds `claude`/`gh`; runs `startServer()` in-process,
  opens the window. Bundled to `dist/electron/main.cjs` by esbuild. The window
  **reopens where you left it**: `rememberBounds` saves its normal bounds +
  maximised flag to the `window_state` setting (debounced on move/resize, and on
  close), and pure `restoreBounds` in `electron/windowState.ts` (unit-tested)
  puts it back, clamped to a display that still exists — a window saved on an
  unplugged monitor reopens centred on the primary display.
- `server/app.ts` — `startServer()` Fastify factory + **all routes** (sessions,
  fs browsing, GitHub, Linear, notepad, terminal WebSocket). Shared by CLI + app.
- `server/index.ts` — thin CLI wrapper over `startServer()`.
- `server/sessions.ts` — `SessionManager` + `DenSession`: owns long-lived PTYs
  (independent of any WS), 256KB scrollback ring (replays on attach), OSC
  title capture, attention (bell) flag, **workspace grouping** (groupId/role),
  and ticket/PR/look/view metadata. Every pane gets a short per-workspace
  `AGENT_BROWSER_SOCKET_DIR` (`socketDir`, `/tmp/den-<id>`, removed with the
  workspace; issue 40), since a socket under a worktree path is too long. Spawns `claude -n <name> [flags] [prompt]`.
  The prompt builders and permission rules below live in
  **`server/instructions.ts`** (pure, no session state); the paths the
  panes and Fox share (`PROGRESS_DIR`, `MANAGER_DIR`, `TODAY_PATH`, ...) in
  `server/paths.ts`.
  `reviewInstruction` asks a review pane for **two** deliverables: the reading
  guide (`~/.den/review/<groupId>.guide.md`, grouped by purpose) and the review
  (the notepad, filed per file). **Every Claude pane gets a system prompt from
  one builder per kind**, shared by `create()` and `restartArgs` so a revived
  pane is started with exactly what a fresh one was (a resumed conversation
  only uses it once compacted; see Restarting exited sessions): `workspaceArgs` →
  `workspaceInstruction` (notepad + house rules) for a workspace main, and
  `singlePaneArgs` for the rest — `reviewArgs` for a review pane,
  `myPrInstruction` (which PR/repo/branch, act on pasted comments, draft
  replies here rather than posting) for a my-PR pane, `lookInstruction` for a
  look pane. **`houseRules()`** is appended to every pane that can commit or
  open a PR: plain ASCII in anything that leaves the machine, and **every PR
  opens as a draft** (`gh pr create --draft`, never `gh pr ready`). A commit
  that fails to sign is retried with the sandbox off, then after asking the
  developer to unlock the signer, never handed over as a script (issue 32:
  runn's sandbox settings block 1Password's `op-ssh-sign`). There is
  no deny backstop for the draft rule — permission patterns are prefix
  matches, so `Bash(gh pr create:*)` can't say "only with `--draft`" — so
  the instruction carries it alone. **`pasteRule()`** (house rule 4, plus
  Fox and a review pane) hands text the developer pastes elsewhere over in a
  fenced code block, never a block quote: Claude Code's TUI hard-wraps, draws
  a bar on quote lines, and drops backticks, so screen copies came out
  broken, while `/copy` offers each block verbatim. **`prDescriptionRule()`**
  (house rule 5, 2026-11-09 at andria's ask) shapes a PR description for
  the human reviewer: Description (200 words at most), then Testing with
  Manual steps (concise, for an engineer who knows the app) and Risks a
  person should test; then a collapsed `<details>` "Agent notes" section
  for what only an agent needs, What was verified included, titled with `&#x1F916;` (GitHub draws the robot emoji, and the
  prompt stays ASCII), with Claude Code's "Generated with Claude Code"
  attribution as its last line rather than the description's. Emoji are allowed in PR descriptions only; the ready
  check's description update follows the same shape. **`ticketDiscussionRule()`**
  (workspace, my-PR, and look panes; the review pane's `REVIEW_CHECKS` and
  Squirrel say the same) has a pane read the Linear ticket's **comments**
  as well as its description, with its Linear tools, since den only hands
  it the description (andria, 2026-10-30: decisions and scope changes live
  in the discussion). **`denIssueRule()`** goes on **every**
  pane kind, review included (andria, 2026-09-29): a den bug, rough edge, or
  improvement idea gets filed as an issue in den's repo (`denIssueRepo()`,
  from den's checkout's origin; check for duplicates first), and because den
  is **public** while the work repo isn't, the issue describes den's
  behaviour only — no work-repo code, file names, branch/ticket/PR names, or
  people. It's the one named exception to the review pane's never-post rule
  (its deny list doesn't block `gh issue create`). All of these are ASCII and unit-tested
  (`paneInstructions.test.ts`, `progressInstruction.test.ts`,
  `reviewInstruction.test.ts`). A new pane kind gets its own builder here,
  not a bare `-n name`.
- `server/inbox.ts` — **telling a running pane something** without typing
  into it (a pane at a permission prompt looks idle, and a typed Enter would
  answer it). `sessions.tell(groupId, msg)` queues the message in
  `~/.den/inbox/<groupId>.<event>.json` and raises the rail nudge if nobody is
  watching; `UserPromptSubmit` + `PostToolUse` hooks in the pane's
  `--settings` (`inboxHooks`, workspace main and my-PR panes) hand it to
  Claude as `additionalContext` on its next prompt or tool call, each event's
  hook claiming the queue with `mv` and removing the other's copy. Verified
  live: a pane asked afterwards reported what den had told it. Panes started
  before this only get the hooks on restart. First user: **set up / run
  feedback** (issue 37) - `runInTab` in `app.ts` types the command with a
  `finishMarker` (`server/tabRun.ts`) and watches the tab (`DenSession.watch`,
  not a viewer, so the bell still nudges) for the printed exit status, then
  tells the pane it started and how it ended, with its last lines
  (`finishReport` in `server/tabRun.ts`). A failure also asks the pane to
  diagnose and fix it then and there and rerun the step, and names any port
  the output says was taken and what holds it (`takenPorts`, `portHolder`):
  runn stacks clash on ports every time (runn-cli without a per-worktree
  Jaeger port), and panes used to report the error and wait to be told.
  Second: **CI watch** (issue 36) - the PR list's fetch (`prCache` in
  `app.ts`) runs `ciFinishes` (`server/ciWatch.ts`) and, for each PR whose
  checks went pending -> pass/fail, `sessions.tellAboutPr` tells its my-PR
  pane and any workspace whose checkout is on that branch. Panes are told
  this (`denWatchRule`) so they stop keeping a `gh pr checks --watch` alive.
  It only runs while the UI polls the PR list (every 60s).
  Third: **stacked branches** (issue 33) - `server/stack.ts`, on a 60s timer
  in `startServer`: one `git fetch` per repo, then per workspace/my-PR pane
  the parent (its PR's `baseRefName`, which `searchPrs` now fetches with
  `mergeable`, else the repo base) and how far HEAD is behind it and behind
  `origin/<branch>`. That's `meta().stack`; `WorkLinkChips` shows `base +N`
  only for a **stacked** parent (behind the repo base is normal) and
  `origin +N`. When a stacked parent's tip moves and the branch is behind,
  the pane is told (`parentMovedMessage`). A PR that conflicts with its base
  gets a `conflicts` badge and counts toward your PR's attention, since
  GitHub won't start CI on it.
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
  review-requested → `isMine`). The three searches (`author:@me`,
  `user-review-requested:@me`, `reviewed-by:@me`) run as **one `gh api graphql`
  request** (`searchPrs`) that also carries branch + review decision, so the
  only per-PR call left is `gh pr checks` — three `gh search prs` calls plus a
  `gh pr view` per PR hit GitHub's secondary rate limit ("GitHub request
  failed", 2026-10-23). `user-review-requested`, not `review-requested`, which
  also matches a request to a team you're in (the developers team on every
  runn PR); a member GitHub's round robin picks is requested by name, so
  that still shows. **GitHub search is flaky**: the same query seconds
  apart can return its `issueCount` with no nodes, so `searchPrs` retries a
  short result (up to 3 tries, nodes unioned), and **`splitByAuthor` buckets
  by the PR's author, never by which search found it** (`reviewed-by` matches
  your own PRs once you've commented, so a short `author` result put them in
  the review list). The review bucket keeps a PR you've reviewed until it's
  merged or closed instead of vanishing the moment your review clears
  GitHub's request (`buildReviewBucket`, `reviewRequestedFromMe` /
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
  `origin/master`), `checkoutPr` (`gh pr checkout` into a worktree or local; then it checks
  the checkout holds the PR's `headRefOid` and refuses with
  `NotAtPrHeadError` if not, issue 30 - a PR session never goes through
  `prepareWork`, which would create the PR's branch fresh off the base),
  `worktreeForBranch` (reuse an existing worktree instead of erroring), and
  `listWorktrees` / pure `parseWorktrees` (every checkout of the work repo, its
  own working copy first — behind `GET /api/git/worktrees`, which the New
  Session dialog lists as "workspaces"), and worktree cleanup: den's own
  worktrees live under `<repo>/.claude-worktrees/` (`DEN_WORKTREE_DIR`,
  `isDenWorktree`) — the only ones it ever offers to remove, never Claude
  Code's `.claude/worktrees/` or hand-made ones. `removeWorktree` keeps the
  branch, so only uncommitted changes (and commits on a detached HEAD) can be
  lost (`worktreeChanges`, `losesWork`), and it refuses those without `force`.
  The routes (`GET /api/git/worktree(s)`, `POST /api/git/worktrees/remove`)
  also refuse a worktree any session's cwd is in. The branch-name rule lives in
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
  prompt init. `web/src/AppRunButton.tsx` renders "▶ run" (the name and command in its title, so a long worktree name can't push the header's buttons off screen) or, when it can
  tell the app is already up, "▶ open <name>" linking to the URL. Pure parts
  unit-tested in `server/apprun.test.ts`.
- **Stack port check** (issue 34): for a runn stack with containers up,
  `appRunnerStatus` also reads `docker ps` (`parseDockerPs`) and
  `runnPortProblem` flags the three ways the app link lied in practice:
  another stack's edge publishing this checkout's `RUNN_PORT_APP` (seen live:
  the main checkout's app port was a worktree's), an edge with no published
  ports (two stacks on one fixed port), and a `project.env` rewritten after
  the stack started. Otherwise it asks `curl -k` whether the URL answers.
  `AppRunButton` shows it as a pink `ports` chip; a set up / run finish
  message to the pane includes it.
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
  13-colour palette both the server (auto-assign) and the picker import.
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
    **Syntax highlighting** (issue 18): `highlight.ts` is highlight.js *core*
    plus only the languages den's diffs hold (TS/JS, Ruby, CSS/SCSS, ERB,
    YAML, JSON, Markdown, shell, SQL, Python; +92 KB to the bundle). A file's
    hunk lines are highlighted as **one text** and `splitHighlighted` splits the
    HTML back into lines, closing and reopening spans at each break — so the
    one-row-per-line structure the gutter, tints, and review column key off
    survives, and a block comment still colours across lines. Minified or huge
    files (`MAX_LINES` / `MAX_LINE_CHARS`) stay plain. **Files collapse** (the
    file label in the notes column, or collapse/expand all); highlighting runs
    only for expanded files. Churn starts collapsed — `shared/churn.ts`: lockfiles,
    snapshots, generated code by path, plus anything the guide files under a
    section titled churn/lockfile/generated/formatting — unless the review
    commented on it.
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
    **Risk level** (2026-11-11, from Linear's PR risk): the intro ends with
    `Risk: low|typical|high|very high - <why>`; `shared/guideRisk.ts` takes
    it out of the intro (parseGuide's `risk`), the Guide tab shows it as a
    `RiskChip`, and a review pane's `meta().risk` (re-read when the guide
    file changes; intro only, so a section's "- risk:" note never counts)
    puts the same chip on that PR's card in the GitHub panel. Medium and
    moderate read as typical; low is sky so it isn't a second "approved".
    `guidePrompt` asks for the line too, so any pane's next guide has it.
  - **Where findings came from** (2026-11-06, after acorn): the review
    ends each finding with a source tag (`[hare]`, `[code-review, verified]`,
    `[ticket]`, `[reviewer]` ...; `SOURCE_TAG` in `reviewNotes.ts`), drawn as
    a chip (`sourceChips`, green when verified) and stripped before posting
    (`stripSource` in `buildReviewPost`). It ends with a `## Checked` section
    (what each pass and helper ran, with results, and what it didn't cover),
    which `parseReview` keeps apart as `checked` and the Review tab folds
    under the general review; never posted. A one-line bullet quotes its
    code in backticks after `path:line`, and `anchorLine` moves the comment
    to the line holding that code when the number drifted (it skips a code
    span that is itself a path).
  - **The repo's own skills** (audit 2026-11-06): den's prompts point the
    crew and the review at the work repo's own skills by role only, with no
    skill names (den is public): hare a performance skill, badger a browser
    QA skill, an API test skill, and a QA review skill plus changed-file lint
    and type-check, raccoon skills for reading CI failures, wolf the repo's
    security review else the built-in one, the review a QA review skill
    (with the real base) and a feature map skill, `ticketDiscussionRule` the
    feature map and a skill for Linear agent sessions, my-PR panes skills
    for review comments, `denWatchRule` no skill that polls CI.
    `ThreadActions` offers resolve only on threads the developer or a bot
    opened (`openedBy`, `PrDetail.viewer`): a reviewer resolves their own.
  - **Ask about a line** (andria, 2026-11-06, after acorn): in a review
    pane's Guide and Review diffs (`DiffView ask`), each numbered line has a
    "?" on hover that opens a box under it; the question goes to a small
    headless chat of its own (`server/lineAsk.ts` `askLine`: `claude -p`,
    Sonnet, effort low, read-only tools, cwd the PR checkout, the diff and
    guide paths in its prompt; a follow-up `--resume`s that line's chat), so
    the review pane's conversation is never touched. Threads persist in
    `~/.den/review/<groupId>.lines.json` (`POST /api/sessions/:id/ask-line`,
    `GET .../line-threads`; shared client store in `LineAsk.tsx`), and
    "-> review" pastes an exchange into the review pane
    (`lineAnswerPrompt`). Verified live: about 12s for an answer citing
    path:line.
  - `PrViews.tsx`: `PrReviewView` (others' PRs — **two regions, one splitter**, so
    it works on a small screen: a tabbed pane above (**Guide** / **Review** /
    **Description**) and the session below. The Review tab is one scroll region — the general review
    first, then the diff with **each file's review comments beside that file's
    hunks** (sticky, via `parseReview` → `DiffView notes=`). The session is told
    (via `reviewInstruction`) to save its finished review as markdown to
    `~/.den/review/<groupId>.review.md` (`reviewNotesPath`; review panes from
    before it wrote to the notepad, and `ensureReviewNotes` moves that over at
    boot in `hydrate()` and on a pane's start; once the file exists it never
    runs again, so a handover is never moved), structured as general review
    then one `## <file path>` heading per file; the view polls it (`GET
    /api/review/notes/:groupId`), so the
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
    its correctness/simplification scope misses. A "WHAT TO FLAG" block
    (from iTerm2's Claude Code integration review prompt; andria, 2026-11-11)
    ranks findings: correctness, security, reliability and performance, then
    contract risk; why not what, calibrated, no style or naming nits. Every
    review, a review pane's and
    the owl subagent's, also runs `REVIEW_CHECKS` (`server/crew.ts`;
    andria, 2026-10-30) **on top of** the full review (which it says to keep
    as thorough as ever), with a line each in the general review: **the
    ticket** (find the PR's Linear ticket and read it with the pane's Linear
    tools, read only: is everything done, anything out of scope?),
    **consistency** (existing patterns, shared components), and **intent**.
    Performance is hare's, not a checklist line. A review pane sees the developer's Linear connector
    tools (checked with `--permission-mode default` + a settings file). The review paste prompt
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
    Review panes carry a review file **and a guide file** — `create()`/`restartArgs`
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
  (same group, shown as tabs) + a notepad at `~/.den/progress/<groupId>.md`.
  The notepad is a **handover, not a log** (issue 27), with **two readers**
  (`shared/handover.ts`): four sections at the top for the developer —
  *Where it stands*, *Done*, *Next*, *Waiting on you* — in plain language with
  no hashes, paths, test runs, or push bookkeeping; then **`## Session notes`**,
  the handover the session writes *for itself* (branch + base, what's
  committed/pushed, half-done work and where, decisions and why, what was
  ruled out, test state, the exact next step). `progressInstruction` tells
  the session to read it first and rewrite both parts in place; that's how a
  restarted pane (no initial prompt) picks the thread back up — verified: a
  fresh `claude -p "Carry on."` finished half-done work from the notes alone.
  A ticket's text sits **below** both (`ticketNotesSeed`), so the notepad
  opens on the status. den keeps a copy of that ticket section
  (`<groupId>.ticket.md`) and puts it back if a rewrite drops it
  (`keepTicket`, pure `restoreTicket` in `shared/handover.ts`; issue 39). The
  seed's session notes start with what den found for the branch
  (`server/startContext.ts`, issue 35): commits the base lacks, PRs for the
  ticket and its Linear sub-issues (`getSubIssues`), and handover files in
  sibling worktrees or Claude Code plans naming the ticket. When the
  ticket's description later changes (`sessions.ticketsUpdated`, on each
  Linear fetch; issue 38), den swaps the new text into the notepad and the
  copy, tells the session the changed lines, and the ticket chip reads
  "edited". **Idle handover** (issue 23): when a workspace main
  pane has been worked in and then gone quiet for 30 minutes
  (`idleHandoverDue`: input since the last handover, no output for the
  window, notepad not written near the end of the work), den refreshes the
  notepad from a **headless fork** of the conversation — `claude -p --resume
  <id> --fork-session --no-session-persistence`, allowed only `Read` and
  `Edit` of the notepad (`runIdleHandover`). **Never** by typing into the
  live pane: a pane at a permission prompt looks just as idle, and a submit
  would answer it (or send a draft left in the input box). The fork saves no
  transcript, so the pane's conversation and the resume list are untouched.
  Once per quiet spell, rearmed by input. Window: `$DEN_IDLE_HANDOVER_MIN` →
  the `idle_handover_min` setting → 30; `0`/`off` disables it (there's no UI
  toggle beyond the per-workspace switch below). It spends tokens with nobody
  watching.
- **Token spend** (issue 11). Each pane's header used to carry a spend chip
  (tokens, and cost at API prices from pricing each transcript); it was
  removed on 2026-10-30 once the field mouse's pace chip (Token pace, below)
  covered the plan's limits, to free header space. Git history has the
  pricing (`sumUsage`, `RATES`, verified to the cent against Claude Code's
  own `cost-state`) if a cost view comes back. The **plan's limits**
  (current session = 5-hour window, current week, % used + reset time)
  reach nothing but a **status line command**
  (`rate_limits` in its JSON stdin, only after a pane's first reply; not in
  `claude -p --output-format json`, no file, no hook), so every Claude pane
  gets a status line via `--settings` (`statusLineSettings` in
  `server/limits.ts`; a review pane's settings file merges it in) that saves
  its input to `~/.den/limits/<groupId>.json` (tmp + mv), then pipes it to
  the developer's own `statusLine` from `~/.claude/settings.json` if one is
  set, so theirs keeps working. `readLimits` takes the newest reading from
  any pane (the limits are the account's); `remove()` deletes the file.
  Panes started before this only get it on restart. Also:
  a per-workspace **handover switch** on the notepad (`handover` column,
  `POST /api/sessions/:id/handover`) — off stops the idle refresh at once
  and drops the notepad instruction from the pane's next start (the house
  rules stay); and the PR dialog's pre-review is now **full / reading guide
  only / nothing** (remembered in localStorage), the guide being the cheap
  option for a PR small enough to read yourself. `NotepadPane` leaves a handover's scroll alone and only
  follows the bottom for an older appended log.
  The notepad is scoped to the workspace: kept across exit/restart, but **deleted
  when the workspace is closed** (`remove()`), so `~/.den/progress` doesn't fill
  with orphans. (The "edit den" workspace passes no seed, so it gets the empty
  handover, or the last editor's carried one (see Edit den itself); its
  opener lives in the initial prompt.)
- **shell** session = a single plain terminal.
- **Single-pane claude** sessions carry a `view`: `look` (ticket + claude),
  `review` (others' PR), `mypr` (your PR), `manager` (Fox, see above), or a
  ticket-look. They also carry
  `ticket` / `pr` / `prRepo` / `branch` for linking. A **look** pane saves the
  ticket (`ticketBrief`, sent as `notepadSeed`) to the group's notepad path so
  `lookInstruction` can point the session at it — the same file on restart,
  deleted by `remove()`. It's a reference file, not a progress log, and the
  look layout doesn't render it. A **my-PR** pane keeps a handover like a
  workspace (`worksLikeWorkspace`), so it can start fresh and clock out onto
  a fresh chat: `singlePaneArgs` ensures its notepad and passes it to
  `myPrInstruction` while the handover is on, and `PrMyView` shows it on a
  Handover tab. A my-PR pane opened before that has no notepad until its
  next start; `runIdleHandover` creates one, since its fork may only Edit.
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
**But a resumed conversation keeps the system prompt it started with**
(Claude Code records it on the first request; `--system-prompt-snapshot`,
default on) until it is compacted, so a plain restart after den's
instructions change still runs the old ones. Turning the snapshot off
re-renders the prompt every request, which would cost cache hits, so den
flags it instead: `DenSession.notePrompt` records a hash of the
`--append-system-prompt` text for each new conversation in
`~/.den/prompts/<groupId>.json`, a resume with a different hash sets
`promptStale` (header chip "old instructions": start fresh to pick them
up), and a later `compact_boundary` in the transcript (`compactions` in
`usage.ts`) clears it. Conversations from before the records aren't flagged.
The scrollback is cleared (fresh process). The frontend keys each `TerminalView`
by `` `${id}:${status}` `` so the flip to "running" remounts it and reconnects to
the new PTY; restart buttons (`↻`) appear on exited rail rows + in the workspace
header. This is the answer to "live PTYs don't survive a restart" — the row comes
back exited, and one click revives it.

Which conversation a restart reopens is `chooseResume` (pure, tested): the
pane's own pinned `claudeSessionId` if its transcript exists, else **a fresh
conversation under that same id** — never "the newest conversation in this
cwd", which is only a fallback for rows with no pinned id at all. Claude Code
writes no transcript until the first message, so an untouched pane has none,
and look panes share the work repo's main checkout with other sessions:
borrowing the newest one there resumed another ticket's conversation (issue 25).

**Starting fresh** (issue 43, den v2 groundwork): `restartFresh` ends a
workspace main pane (if running, via `stopPane`, shared with `setOwned`),
pins a **new** `claudeSessionId`, and restarts it - `chooseResume` then
starts a new conversation under that id, which picks up from the handover
its system prompt says to read first. The button's route first has a
headless fork bring the handover up to date (`runIdleHandover(s, "fresh")`)
when the notepad is older than the pane's last output or transcript write
(`handoverBehind`, shared with Hedgehog's round), and leaves the pane
running with a `handover_failed` 409 if that fails; Start my day's wakes
skip it, since clock out just wrote the handovers. Only panes `canStartFresh`
(`shared/handover.ts`: a workspace main, my-PR, or taken-on review pane with
its handover on, or Fox). Route:
`POST /api/sessions/:id/restart` with `{ fresh: true }`; UI: the header's
`FreshStartButton` (confirm in a `ConfirmCard` under the button, like
`OwnPrToggle`'s: inline confirm text in the never-shrinking `.term-actions`
pushed its buttons off screen). The new conversation then gets its first
message **through Fox** (andria's pick, 2026-11-06), so it hears anything
new Fox knows for it: `freshBriefRoute` types `freshBriefPrompt` into Fox
when its turn state is done and the developer has no draft in its prompt
(`DenSession.draft`: `draftAfter` counts typed characters, minus
backspaces, ignoring escape sequences (keys, focus and SGR or X10 mouse
reports, OSC and DCS replies; a bracketed paste counts as text), zeroed by
Enter or Ctrl+C; Up, Ctrl+R, and Ctrl+Y count as a draft, and editing keys
it can't follow leave the count, so it errs toward a draft), or leaves it in Fox's inbox while Fox works. Fox waiting on the
developer, a draft, or no Fox: the route pastes and submits
`freshStartPrompt` (read the handover, say where it stands, carry on)
into the pane itself, and so does a timer when the pane still has no turn
after `FRESH_BRIEF_WAIT_MS` (3 minutes), so it never sits waiting.
`spawn()` zeroes `lastOutputAt` so that a paste's `waitUntilIdle` waits
for the new process to draw. Start my day's wakes don't send it: Fox briefs those (below). A plain restart still
resumes the long conversation, so this is what makes ending chats save
tokens. The handover instruction also asks for when PR/CI/review state was
last checked and, on a stacked branch, the stack in merge order (issue 44).

**Token pace** (issue 45): `LedgerChip` in the topbar polls `GET /api/usage`
(`sessions.usageOverview`: the newest `readLimits` + running Claude panes by
`contextSize`, the input of the conversation's latest turn, from
`usage.ts` `lastContext`). Pure `weekPace` (`shared/pace.ts`, tested in
`server/pace.test.ts`) puts the week's use against an even spend from the
window's start (reset minus 7 days): `early` for the first 10% of the week,
`ahead` past the even line + 3 points, and when the limit runs out at the
rate so far if that's before the reset. The hover lists the panes with the
largest context, the first to start fresh. Each Claude pane's header also
has the field mouse's **context chip** (`ContextChip`: tokens in context,
the bar % of the window; peach from 200k or 60%, pink from 400k or 80%,
`CONTEXT_FILLING_TOKENS`/`CONTEXT_FULL_TOKENS`, andria's pick 2026-11-03,
since on a 1M window peach only came at 600k), from `context_window` in the same
status line file (`readPaneContext` in `limits.ts`, `meta().context`),
ignored while the file's `session_id` isn't the pane's current
conversation.

**The field mouse watches tokens** (andria, 2026-11-06: "make sure we're
not going over suddenly"). `server/fieldMouse.ts`, on a 60s server timer
(`sessions.watchTokens`, so it runs with the window closed): it keeps a
26h history of the plan's limits (`~/.den/ledger/readings.json`, a reading
when a pane's status line reports a new one), and pure `assess` flags a
5-hour window set to run out before it resets at the last half hour's rate
(`tight`), a week set to run out early (`tight`) or ahead of pace
(`watch`), and a jump (`WEEK_JUMP` points in an hour, `SESSION_JUMP` in
half an hour; `watch`). `burners` names who is spending: each running
pane's transcript plus every subagent and workflow agent under it, read
incrementally, weighted by API price ratios (`weigh`), as shares of the
last 30 minutes. New alerts go to a running Fox once each (inbox message;
Fox tells the developer and suggests what to pause), to a native
notification and the pace chip (`mouse-watch` / `mouse-tight`, alerts and
top spenders on hover), and into the digest. While `tight` it also
manages: no Fable for owl (`fableHasRoom`), no quiet-spell idle handovers
(clock out, nap, and start fresh still write them), and the done check
needs a second click (`tokens_tight`; `api()` errors now carry `code`).
It never stops a session.

**Pane settings and turn state** (2026-11-06, from the Claude Code docs
research). Every Claude pane's `--settings` comes from one builder,
`paneSettings` in `sessions.ts` (manager and review settings files spread
it too): den's status line with `refreshInterval: 30` (event-only updates
left idle panes' limits and cache state stale), `idleCompaction: false`
(compacting while the developer is away spends tokens with nobody watching;
den starts stale chats fresh from the handover instead), and `mergeHooks`
of `turnHooks` + inbox + crew. `server/turnState.ts`: UserPromptSubmit /
PostToolUse / Stop / Notification (matcher: the needs-you types, not
`idle_prompt`, which fires a minute after every finished turn) save the
hook input to `~/.den/turn/<groupId>.json`; `watchTurns` (fs.watch) and the
5s timer call `DenSession.checkTurn`, which flags the rail on a turn that
finishes or stops for the developer while unwatched, and `meta().turn`
says which ("Waiting for you: <message>" in the rail tip; any input
clears it, since Escape at a prompt fires no hook). `Turn.detail` gives
the rail a line under the session name (2026-11-11, from iTerm2's Claude
Code integration): for a permission prompt, what the tool would run
(`toolSummary`), from a PermissionRequest hook that writes both the turn
file (needs-you as the prompt appears) and `<groupId>.tool.json`, which
the Notification reads because it arrives about 6s later and says only
"Claude needs your permission" (checked live with the CLI, 2.1.322); for
a finished turn the developer hasn't seen, the Stop hook's
`last_assistant_message`, one line. Hidden on the open session. Panes
pick up the PermissionRequest hook on restart. Clock out's
"still working" uses it, plus "waiting on you" as a blocker. The OSC title
glyph stays as the fallback for panes started without the hooks. Stop was
verified live in `claude -p`; Notification wasn't (no prompts in -p). The
crew's routine helpers (badger, hare, bowerbird, tanuki, squirrel) run at
`effort: "medium"` (`AgentDef.effort`; `--agents` accepts it, verified).
`ContextChip` marks a chat **cold** when `prompt_cache.expires_at` has
passed and `recache_tokens_if_cold` is past the peach line: the next
message re-reads it all at full price, the cheapest moment to start fresh.

**The Manager, Fox** (issue 46, den v2; plan in the issue). One Claude pane,
`view === "manager"`, named `MANAGER_NAME` ("Fox"), that runs the
developer's day across the other sessions instead of them being the glue.
- **Start my day** (topbar button while Fox isn't running, and in the Today
  header): `POST /api/manager/start` writes `~/.den/manager/digest.md`
  (`server/digest.ts` `buildDigest`: every Claude pane with the developer's
  part of its handover via `digestSessions`/`developerSections`, PRs from
  `prCache`, Linear from `linearCache`, the week's `weekPace`; GitHub and
  Linear bounded at 10s), then `startManager` (create, or `restartFresh` if
  exited) and pastes + submits `managerStartPrompt` (`server/manager.ts`).
  den's code gathers the facts so Fox never re-polls GitHub. The start
  prompt names the panes `wakeClockedOut` started fresh, and Fox briefs
  them with `SendMessage` (read your handover, plus what it, tanuki, and
  raccoon found for that session) instead of den pasting a prompt, so each
  wakes with the day's news; refresh and the day pass on new findings the
  same way, never worded as the developer's approval. While Fox
  runs, the Today header's button is **refresh** instead (`POST
  /api/manager/refresh`: rewrite the digest, then paste + submit
  `managerRefreshPrompt`: tanuki sweeps the inbox, Fox updates the list,
  keeping the developer's ticks), meant for any time in the day.
- **Keeping Fox's picture current** (Fox's own asks, 2026-11-06): den tells
  a running Fox (`tellManagerWaiting`, on the 5s flush timer; Fox's
  `--settings` now has `inboxHooks`, no nudge) when a session's "Waiting on
  you" changes (`waitingChangeMessage`), since the developer often answers
  in the session. The PR caches rewrite `~/.den/manager/prs.md`
  (`buildPrState`) on every fetch, which Fox reads before presenting a PR
  item (a missing PR = merged/closed). The digest names each session by
  `agentName` (the `-n` name its Claude was started with, which ListAgents
  shows; `name` follows OSC retitles), with its rail title when different,
  its handover path, and "new since the last digest"
  (`digest-sessions.json`); tags GitHub `review_requested` notifications
  "me by name" / "my team only" and drops the rest (`tagReviewRequests`);
  and lists open review threads on others' PRs too (review-requested +
  pickup, `MAX_OTHERS_THREADS`), since Fox's subagents can't call `gh api`.
  Today matches `(session: X)` on `name` or `agentName` (`isNamed` in App).
  Changes made while Fox is stopped, or during Hedgehog's round, aren't
  sent, and Fox's inbox is cleared when it starts: the digest carries them.
  Items compare loosely (case, spacing, end punctuation).
  A refresh whose today.md heading is another day (`todayIsOld`) tells Fox
  to start a new list carrying only open items.
- Fox writes `~/.den/manager/today.md` (Decide / Unblock others / Continue /
  FYI, `- [ ]` items with `(session: <name>)`, then With sessions: plain
  bullets for session-owned "Waiting on you" items, never presented); `TodayView` renders it above
  the Fox pane (each box is a button: `tickBoxes` numbers them in file order to
  match `setTodayItem`; a click ticks or unticks, a double-click marks won't
  do (`- [-]`, crossed out with its detail bullets, which `todayMarkdown`
  marks since markdown.ts renders them as siblings, kept so Fox doesn't raise
  it again) or undoes it (`nextTodayState`), and the click waits 250 ms so a
  double-click doesn't tick first (a click on another box meanwhile lands the
  pending one at once); it posts `/api/manager/today/mark` with the item's text, refused
  if Fox rewrote the list meanwhile. Fox marks won't do too, and keeps the
  developer's marks) (review-view layout, one splitter), polls
  `GET /api/manager/today`, and turns `(session: X)` into a button that opens
  that rail session (`linkSessions`). Fox is pinned to the top of the rail.
- Fox talks to sessions with Claude Code's own `SendMessage` (den panes show
  in `ListAgents` by pane name). It may relay the developer's answers as
  "The developer said in Today at HH:MM: ...", and `managerRelayRule` (in
  workspace and my-PR prompts) tells sessions that form, and only it, counts
  as the developer's words - a test pins the two strings together.
- `managerInstruction` + `buildManagerPermissions` (deny backstop: commit,
  push, merge, rebase, reset, the writing `gh pr` subcommands, `gh api`;
  allow: Today, its handover, reads under `~/.den`). Runs `--model opus`.
  It inherits the developer's permission mode (auto, for the maintainer), so
  the deny list is the hard line: verified live, Fox in auto mode went
  straight to filing a den issue (`gh issue create` is allowed by
  `denIssueRule`) when a test server's empty digest disagreed with
  `ListAgents`. **Don't test Fox on an isolated server against real
  sessions**: `ListAgents` and `~/.den/progress` are the real ones.
- Its cwd is the **work repo**, not `~/.den/manager`: Claude Code opens an
  untrusted folder on a trust prompt whose default is "No, exit", and the
  start prompt's Enter would answer it.
- Next (issue 46): Clock out (safe-to-end check, ask each pane to refresh
  its handover, end, fresh tomorrow, keep-alive pin), then the workers.
- **The crew are forest animals** (andria, 2026-10-29), so keep any new
  one in theme. Fox (Manager, Opus); kits (Fox's cubs: the ticket sessions that write the code, scarf in the session's colour); Tanuki (Linear inbox + GitHub notifications, Sonnet); Raccoon (CI failures across PRs, Haiku); Hedgehog (handover refresh at clock out, the session's own model); Field mouse (token pace, plain code); Badger (testing and QA, Sonnet); Hare (performance, Sonnet); Wolf (security, Opus, uses the repo's security-review skill); Owl (code review: colleagues' PRs in review panes, and a kit's own PR before the developer looks; also the advisor kits and Fox consult on hard problems; Opus, or Fable for the hardest when the field mouse says the week has room). Bowerbird (design consistency, Sonnet, 2026-11-06): contrast, design tokens over raw values, spacing, alignment, type and icon sizes, shared components, and the design the ticket links; drawn holding a colour swatch card. Badger, Hare, Wolf and Bowerbird are reviewers a kit can call in to check its own work. Squirrel (Fox's errand runner, Sonnet by Fox's own pick, 2026-10-30): read-only jobs the developer asks Fox for, such as going through a Linear project for tickets worth picking up, matching tickets to PRs, or pre-reading a PR. Beaver (clean up, Sonnet, 2026-10-30): the clean-up workspace (`den:cleanup`, the rail's beaver button) is drawn as Beaver and runs `--model sonnet` (`workspaceArgs`), since its audit is mechanical and the developer's approval of its plan is the safety step.
  Pixel art: `critterSprites.ts` (18x19 like the fox's SIT, same outline
  and eyes; `CREW` holds name, job, model, built), drawn by `Critter.tsx`
  with the fox's `rasterize` (`tint` recolours a kit's scarf). den shows
  the crew strip in the Today header (resting until built, or while Fox is
  stopped) and the field mouse on the pace chip.
  Gallery: https://claude.ai/artifact/5Dn81Siu4mP7Qbu6Jg7RBA - update it
  with any sprite or name change.
- **The reviewers and advisor are real subagents**:
  `server/crew.ts` builds Claude Code `--agents` JSON - `kitAgents` for every
  workspace and my-PR pane (owl, badger, hare, wolf, bowerbird, raccoon, each with its
  model and a report-only prompt), `reviewAgents` (the same minus owl) for a
  review pane, and `managerAgents` (owl) for Fox - and `crewRule` (workspace
  and my-PR prompts) / `reviewCrewRule` (in `reviewInstruction`, run
  alongside the code-review skill; it also tells the pane it *is* Owl) say
  when to call them. **The developer can call them too**: `CrewButtons` in
  a workspace, my-PR, or review pane's header is one button holding the
  helpers' heads (the card draws each whole animal; five separate buttons squeezed the path and branch out of
  the header at 1240px), each **bouncing side to side (stepped) while the pane has that subagent at
  work** or it was just asked for from the card ("on its way", up to 2 min
  until the pane starts it), and dimmed otherwise (`server/crewActivity.ts`: SubagentStart/Stop
  hooks in the pane's `--settings` append to `~/.den/crew/<groupId>.jsonl`,
  replayed as `meta().crewActive`; an agent whose transcript has been quiet
  15 min counts as gone; cleared on pane spawn/exit); it opens a card listing each helper's job with an
  "ask" button that pastes and submits `crewAskPrompt` (`prompts.ts`), so
  the pane calls its own subagent. Fox's header has one too (`crewFor
  ("manager")`): tanuki and raccoon rewrite the digest first (`POST
  /api/manager/digest`, `writeDigest` in `app.ts`), since it dates from Start
  my day; squirrel and owl are "brief", a starter left unsubmitted with the
  pane focused, since they need to be told the job. A failing-CI
  message from den (`ciMessage`) lists the failing checks with links and
  says to hand them to raccoon: before that, sessions read their own logs
  and never called it (andria, 2026-10-30). Owl runs on Fable when `fableHasRoom` (the week isn't ahead of an
  even pace), else Opus; full model ids work in `--agents` (verified: a
  subagent with `"model": "claude-fable-5-1"` ran on Fable). Panes pick
  their crew up at spawn, so existing ones need a restart.
- **Ready check** (the done check, widened 2026-11-06 at andria's ask: "is
  this PR ready for a human reviewer, as an easy approval"): a kit's crew
  card has a "run" row that asks the pane to run it, a Claude Code
  **workflow** (the Workflow tool), not a single subagent:
  `server/doneCheck.ts` holds the script (`DONE_CHECK_SCRIPT`, plain JS, no
  template literals except the build-time `${...}` that embed
  `commentRules` / `testingRules`, no `Date.now()`), written to
  `~/.den/workflows/den-check.js` at startup, and
  `POST /api/sessions/:id/done-check` pastes `doneCheckPrompt`. The scope
  agent (medium effort) also finds the PR and sizes the **blast radius**
  (the repo's skill for sizing a change's blast radius, if it has one: work per item, big tables,
  schema, permissions, data model, what a click-through can't confirm) into
  `tripwires`, counting hits as performance / security. Then in parallel:
  `requirements` (the ticket and its comments, the PR description,
  conversation, reviews and threads, since product and design comment
  early: unmet criteria, unanswered comments, scope creep, what the
  description lacks), owl (bugs first), badger (tests, changed-file lint and
  type-check, `gh pr checks`), `tidy` (low-value comments and tests by den's
  own rules, leftovers, over-complication, duplicates, inconsistency), plus
  hare / wolf / bowerbird when the scope says performance / security / UI,
  as the pane's own subagent types (`agentType`); then a skeptic per
  high/medium finding, most serious first across all helpers, capped at
  `DONE_CHECK_MAX_VERIFY`. The severity rubric ranks an unmet requirement
  high and an unanswered comment or unasked-for change medium, so they
  block `ready`; a skeptic checks a requirements finding against the ticket
  and PR, not the code. The tripwires go into the requirements, hare, and
  wolf asks; requirements and tidy run at medium effort. It returns
  confirmed / unverified / refuted, which helpers failed, `tripwires`, and
  (own PR only) `ready`: nothing high/medium open and every helper
  reported. `CheckResults` shows that verdict as "when it ran", since the
  pane fixes afterwards and doesn't re-run; its chat verdict is the live
  one. The pane fixes, cuts or undoes only what it agrees with (and lists
  it), drafts replies, updates the description (file paths for
  screenshots; the PR stays a draft, and it never opens one), and ends with
  a verdict. The route
  passes the pane's base (`meta().stack.parent`) and only serves kits.
  Verified live 2026-11-06: agent types resolve and a run on its own diff
  took 9 agents, ~5 minutes, and about 700k subagent tokens.
  Only from the button: a session runs a workflow only when the developer
  asks, so `crewRule` still names the helpers one by one.
  `doneCheck.test.ts` runs the script against fake hooks.
- **Checks log** (2026-11-06): the work panel's **Checks** tab
  (`ChecksTab.tsx`) lists every crew helper's finished run and every ready
  check / deep review result, newest first, filterable by kind (security =
  wolf, performance = hare, design = bowerbird, testing = badger, code
  review = owl, ready checks, deep reviews, other) and searchable by PR,
  ticket, session, or summary. Unlike the crew card's per-pane "Recent
  helper runs" and "last check", it lasts after the workspace closes:
  `server/checkLog.ts` `recordChecks` copies new runs (`newCrewRuns`, crew
  agent types only, so a workflow's general-purpose scope and skeptic agents
  are left out, while its owl / wolf / hare runs are kept) and new check
  results into the `checks` table (`store.ts`, newest 2000 kept) with the
  session's name, ticket, branch, and PR. It runs on the 60s timer, on
  `GET /api/checks`, and in `sessions.remove` before the workspace's files
  go. `GET /api/checks/:id` returns one row's body (a `CrewRun` or a check
  result, opened in `CheckResultsDialog`).
- **Bug buster** (2026-11-09, for rapid response weeks; off unless the
  developer starts it): the work panel's **Bugs** tab (`BugsTab.tsx`). A
  first-run form takes the Linear project's URL (`projectSlugId` keeps the id
  at the end of its slug) and the team whose triage queue to card, saved in
  the `bug_buster` setting (`bugState` in `server/bugBuster.ts`), never
  hardcoded, since den is public. **Start** (`POST /api/bugs/start`) ranks the
  project's open tickets with pure `rankBugQueue` (urgent first, priority
  "none" last, oldest first within a priority; leaves out started, on-hold
  (a state name with wait / block / hold / feedback), assigned to someone
  else, PR-linked, or already-open-in-den tickets, with why), writes it to
  `BUG_QUEUE_PATH`, and hands Fox `bugScoutPrompt`: ids only, typed in
  when Fox's turn is done, left in its inbox while it works, refused
  (`fox_busy`, naming the cause from `freshBriefBlocker`) while it waits on
  the developer (`freshBriefRoute`), before the queue file is touched; a Fox
  that isn't running is started for it. Fox runs the **`den-bugs`**
  workflow (`BUGS_SCRIPT`, written to `~/.den/workflows/den-bugs.js`, read
  only): a Sonnet scout at high effort per bug (cause, files, plan, S/M/L,
  and whether the fix is simple, which needs no tripwire from the repo's
  blast radius skill, if it has one; the bug session re-sizes it too), an Opus skeptic at medium effort on each
  "simple" call (that call lets a session fix without asking), and a Sonnet
  triage card at medium effort per triage report (Fox's fields: symptom,
  who, severity, priority, repro, area, duplicates, size, easy, next step),
  `SCOUT_BUGS` and `SCOUT_TRIAGE` at most. Fox saves it to `BUGS_PATH`
  (its settings allow `Workflow` and that file) and the tab shows it
  (`validBugsResult`). Every ticket id on the tab (queue, skipped, which
  carry their `issue` for this, and triage) opens **`BugDialog`** for a quick
  read (the scout's or triage helper's findings, the description, and
  comments; the rows stay to the id, chips, and title); its "Assign to me and work on it" goes
  through `TicketDialog`'s workspace step like an assigned ticket
  (`workOnTicket`, a plain ticket session, not a bug-buster one) and then
  `POST /api/bugs/assign` (a failure says to assign it yourself; already
  yours, it's just "Work on it"). **Claim and start** (`POST /api/bugs/claim`)
  re-ranks against Linear, assigns the unassigned picks to the key's owner
  (`assignToMe`, den's only Linear write, on that click or the bug
  dialog's below), and
  `fillBugSlots` (queued, one run at a time) starts a worktree session per
  claimed bug through `app.inject` on `POST /api/sessions`. **Ticket text
  never goes in a message**: the ticket and the scout's card are the
  notepad's ticket section (`bugNotesSeed` / `bugTicketSection`), and
  `bugSessionPrompt` is den's words plus the id: reproduce, size the blast
  radius, fix if simple (never CI, workflows, dependencies, build or install
  scripts, or secrets) else options under "Waiting on you", badger, den's
  ready check against the repo base (a second run allowed), then "Ready for
  a draft PR". **The developer approves each PR**: Fox weighs the
  session-written check result with the diff, puts "open the draft PR" under
  Decide, and passes their yes on in the relay form. A bug isn't started,
  and lands in `held` with why, when Linear gives no valid branch name, its
  branch is already on origin (`remoteHasBranch`: someone may have started),
  or the create fails. Pure `bugSlots` keeps `BUG_SLOTS` (5) at work: a
  workspace for a started ticket holds its slot, running or not (clock out
  and restarts stop panes), until its branch has a PR or it is removed. The
  filler runs on claim and every minute, only while Fox runs and the field
  mouse isn't tight; claiming a bug again resets it. Fox leads by
  `bugLeadRule` (in its system prompt, and carried in `bugsStartedMessage`
  when Fox's prompt is stale); that message names ticket ids only, and a
  session is never named like Fox. Fox's settings deny the Linear
  connector's write tools (`LINEAR_WRITES`), which binds its scouts too.
  **Stop** lets unstarted claims go; sessions at work carry on. The three
  app stacks cap is an instruction in the bug prompt, not enforced.
- **Deep review, check results, and helper runs** (2026-11-06, after
  acorn): the check script has a review mode (`args.mode: "review"`): a
  `code-review` pass (the skill plus the consistency check and the repo's
  QA review skill), a `ticket` pass (Linear, read only), badger, and hare /
  wolf / bowerbird when the scope says so, then the same skeptics. The Review tab's
  "deep review" (`DeepReviewButton`, `POST /api/sessions/:id/deep-review`,
  `getPrBase` for the base, gated like the done check) pastes
  `deepReviewPrompt`: run it, save the result, write the review from it
  with source tags. Both prompts have the pane save the returned object to
  `~/.den/checks/<groupId>.json` (`checkResultPath`; panes get `--add-dir`
  on it, a review pane `Workflow` + `Write` of it), and "last check: N
  confirmed..." (`CheckResultsButton`, in the Review tab and a kit's crew
  card) opens every finding with its source, severity, the skeptic's
  reason, and what each helper checked and couldn't. The crew card also
  lists **recent helper runs** (`CrewRuns`, `GET .../crew-runs`): the
  SubagentStop hook now also appends to `~/.den/crew/<groupId>.runs.jsonl`
  (kept across restarts, removed with the workspace), and `summarizeRun`
  reads each run's transcript for its brief, the shell commands it ran, its
  model, tool count, duration, and report (the SubagentHandback message
  when it handed one back). `CrewRunDetails` (here and in the Checks tab)
  shows the report first and tallest, then the brief, then the commands in
  a short scroll box, since the report is what the developer reads.
- **Clock out**: the topbar's "clock out" opens `ClockOutDialog`,
  fed by `GET /api/manager/clockout` (`sessions.clockOutVerdicts`: every
  running Claude pane, reviews, my-PR and look panes included, with pure
  `clockOutBlockers` - busy
  (output in the last 20s), a merge or rebase in progress or staged changes
  (`gitWorkState`), CI pending on its PR from `prCache`). Ticked panes go to
  `POST /api/manager/clockout` -> `clockOut`: Hedgehog's round is the idle
  handover fork (`runIdleHandover`, now awaitable; skipped when the notepad
  is newer than the pane's last output, and for a pane that isn't
  `canStartFresh`, whose notepad is a review or ticket, not a handover),
  then `stopPane`, and the id goes in `~/.den/manager/clocked-out.json`.
  Start my day calls `wakeClockedOut` first, which `restartFresh`es each
  one that keeps a handover and plain-restarts (resumes) the rest (not
  Fox, which `startManager` handles). Attention (the bell) is deliberately not a
  blocker: it fires at the end of every turn. Claude Code rings no
  bare bell; every BEL it prints ends an OSC (title spinner frames, links),
  so `scanOsc` in `sessions.ts` skips those and a turn's end is its title
  glyph going from a spinner to "\u2733" while nobody watches (`titleBusy`). **Nap** (the
  topbar's "💤 nap", `POST /api/manager/nap` -> `sessions.nap()`) is the
  same round (`hedgehogRound`, `kind: "nap"`) without ending anything:
  every running Claude pane, before a break; one that isn't
  `canStartFresh` is listed done at once as `noHandover`.
  It's worth more than the 30-minute idle handover when the laptop closes,
  since a sleeping laptop runs no timers. A **keep-alive pin**
  (`keepAlive` column, `POST /api/sessions/:id/keepalive`, the header's
  "pin") keeps a pane out of it every night - it shows as "pinned
  to stay running" and keeps its conversation.
- **Going through the day**: a rail row has one pink "!" (`attentionNote`
  in App) when the session rang the bell while unwatched, or its handover's
  "Waiting on you" lists something you **haven't seen** - most handovers
  always list something, so a "needs you" chip on every row was noise. Seen =
  the list as it was when you last had that session open
  (`den.seenWaiting` in localStorage). Hovering the "!" shows why, in a
  window-fixed tip (`.attn-tip`; the rail's scroll box clipped a CSS one).
  The items come from `waitingItems` (`shared/handover.ts`, tested), served
  as `meta().waiting` and re-read only when the notepad's mtime changes. Session
  headers get "‹ Today" (back to Fox) and "next ›" (`nextItemSession`: the
  next open item's session on the Today list, back to Today after the last;
  shown only while this session is on the open list, from a 20s poll of
  today.md). The header keeps its buttons in `.term-actions` (never
  squeezed) and lets the path and branch give way first; fresh is "✦", the
  pin "📌", and there's no "claude · running" text. The topbar holds one day
  button (☀ start until Fox is up, then ☾ clock out) and a compact pace
  chip (mouse, %, bar; words only when "ahead"), and the title chip has no
  kind badge. The
  work panel folds to a 46px strip of counts (`den.workFold`, the "»"
  button, or Cmd+\\), and has Linear / GitHub tabs (`den.workTab`), with
  GitHub split into Review requested / My open PRs / Open PRs for review (`den.prTab`); a tab
  shows "!" when something in it needs you. **PR size** (2026-11-11, from
  Linear's line counts): both PR searches fetch `SIZE_FIELDS` (per-file
  counts, first 100 files; hare measured GraphQL cost unchanged at 1, about
  2 KB more per PR) and `prSize` (`shared/fileKind.ts`, tested) counts only
  implementation files; the card shows that count with "*" when tests,
  docs, or generated files make the total bigger (`SizeCount`, total in the
  tip). Over 100 files it falls back to the totals. `fileKind` takes the
  repo's `.gitattributes` first (linguist-generated / -vendored /
  -documentation, `-diff`, Linear's review-test / -generated /
  -documentation; fetched once a day per repo, `repoAttributes`, a failed
  fetch retried after 5 minutes), then
  den's churn paths, then test and docs path patterns. `withPickNotes`
  sorts team PRs by that size. The diff view's folding still uses paths
  only (`shared/churn.ts`). **Snooze** (2026-11-11, from Linear's review
  snooze): a card's "zz" (shown on hover or focus) hides it until tomorrow 9am, for 3
  days, or for a week (`Snooze.tsx`); `den.snoozedPrs` in localStorage,
  held in `WorkData`, which leaves snoozed PRs out of `prs` / `flatPrs`, so
  no card, tab "!", or notification shows them. Each list ends with "zz N
  snoozed" to see them dimmed and wake one. Expired snoozes drop out on the
  next poll. The server doesn't know, so Fox's digest still lists them. Fox is drawn as the whole
  sitting fox (`Fox pose="sit"`, not a bust) in place of a colour dot
  (rail, header, title chip), so it never reads as one of its kits.
  Every session writing code is drawn as a kit whose scarf is the
  session's colour, and a review session as Owl (`sessionIcon` in App,
  `Critter bust` crops to head and scarf so the colour reads at 2x in the
  rail); only shells keep the dot. The palette is andria's 13
  colours in `shared/colors.ts`; `RETIRED_COLORS` maps the old 9 to their
  nearest, and `store.ts` recolours old rows on every boot (idempotent).
- **Tanuki and Raccoon**: the digest gains `## Inbox` - unread
  Linear notifications (`getInboxNotifications`, a query of its own so a
  schema surprise can't break the ticket list; newest first) and GitHub
  threads the developer takes part in from the last 24h (`getNotifications`,
  `gh api notifications?participating=true`, `notificationWebUrl` for links)
  - plus the **open review threads on the developer's PRs**
  (`openReviewThreads` in `github.ts`: unresolved, not outdated, and
  whether the last comment is someone else's), so tanuki says which PRs
  have work to do now and which session should do it - and each PR's failing checks by name with run links (`failingChecks`,
  from the same `gh pr checks --json bucket,name,link` call), plus
  `sharedFailures` (a check failing on more than one PR; tested). Fox's
  `managerAgents` add tanuki (Sonnet, sorts the Inbox section) and raccoon
  (Haiku, reads failed logs with `gh run view --log-failed`, says flake or
  real and whether a fix landed on the base; never reruns). Kits, my-PR and
  review panes get raccoon too, for their own red CI.
  **Open PRs for review** (andria, 2026-11-06, design agreed with Fox):
  `getTeamReviewPrs(repo)` (andria, 2026-11-11: every open PR in the work
  repo, `repo:<githubRepoOf(workRepo)>`, up to 50, since the team rarely
  sends team review requests; without a GitHub origin it falls back to
  `review-requested:@me -user-review-requested:@me`), minus drafts, their
  own, and ones they reviewed, then
  `reviewedByTeammate` drops any PR someone other than its author has
  reviewed, comments included; bots don't count) feeds the work panel's
  third GitHub tab (`GET /api/github/team-prs`, a 120s `teamPrCache` the
  digest shares) and the digest's `## Team PRs to pick up` (where pure
  `pickupPrs` also drops failing CI and PRs a session is on). Tanuki picks
  the likely easy approvals from that section (at most five `gh pr diff`
  reads) and Fox writes them to `~/.den/manager/review-pickup.json`
  (`server/pickup.ts`: `{updatedAt, notes: {"<repo>#<n>": {easy, why}}}`,
  allowed in `buildManagerPermissions`); `withPickNotes` tags those cards
  `easy` (the why in its title and under the card) and sorts them first,
  then smallest. A note for a PR no longer listed is ignored, so the tab is
  right on days Fox doesn't run. Cards open the PR dialog like the others;
  nothing approves, comments, or assigns. today.md has no picks section,
  just an FYI line with the count.

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
- **Worktree cleanup**: closing a session that was working in a worktree den
  made (and that nothing else uses) offers to remove it
  (`WorktreeCleanupDialog`, via App's `closeAndOfferCleanup`), saying what
  would be lost; the New Session dialog's workspace list has a remove button
  per den worktree plus a batch "clean up N unused den worktrees" for the ones
  with nothing to lose. Wording and the batch filter are pure in
  `worktreeCleanup.ts` (tested).
- Claude workspace = **main + shell + handover notepad**; notepad renders
  markdown, is editable/savable; the main Claude keeps it current as a
  one-glance handover (see Data model).
- **Resizable** panels (draggable splitters, sizes persisted to localStorage).
- Session **titles**: Claude auto-titles via OSC (shells don't); manual rename
  locks it; the **topbar tints to the active session's colour + shows its title**.
- **Reactive pixel-art fox**: topbar status fox — `alert` when something needs
  *your* action: a PR needing you (authored PR failing CI / changes requested, or
  a review you owe), **unread Linear notifications**, or an assigned ticket
  that's **urgent and not started** (issue 14: `isUrgentUnstarted` —
  priority 1 in triage/backlog/unstarted; urgent work already under way, and
  lower priorities, don't alert; that ticket's card gets the same pink `!`
  as a PR card). The fox's tooltip lists *which* of these fired
  (`foxReasons`). A PR you're *reviewing*
  failing its CI does NOT alert, and a review-requested PR that's **already
  approved** no longer alerts. The pose is derived (in `App.tsx`) from three
  inputs — `prNeedsMe` + `prCount` + `linearNotifs` + `urgentTickets` — not set inline. Else `happy`
  (open PRs) / `sit` (none). It sleeps (`tuckedIn`, over everything else)
  once Hedgehog's clock out round finishes with nothing failed, until Start
  my day (`wakeClockedOut` drops the finished round; App's `startMyDay`
  re-fetches it); a nap doesn't count. Sleeping fox (`SleepingFox` in
  `Fox.tsx`, with its z's) also in the empty state; walking fox in
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
  **■ stop** (issue 28) sits beside it while anything is up (`canStop`): a
  runn stack with **any** container up (`parseRunnStatus` `containersUp` — the
  app container can be down while postgres still holds memory) gets the repo's
  own teardown, `conductor.json` `scripts.archive` (runn: `runn down`), typed
  into a new shell tab like ▶ run; a script app gets Ctrl-C in the tab den
  started it in (`appTabs` in `app.ts`). Closing a session whose checkout's
  stack is still up offers to stop it in the same dialog as the worktree
  removal (`WorktreeCleanupDialog`), **stop first** — `POST /api/app/stop-dir`,
  only for a checkout of the work repo — since a stack whose worktree is gone
  can't be found by its own teardown. `shortCommand` shows conductor.json's
  guarded script as the command it runs.
- **Set up a fresh worktree** (issue 10): a new worktree lacks the repo's
  gitignored local files (`.env`, generated artifacts), which live only in the
  main checkout. Den reads the repo's **own** setup command — `conductor.json`
  `scripts.setup` (Conductor's convention; runn's is
  `./scripts/setup-worktree.sh`), else `scripts/setup-worktree.sh` — so no
  work-environment steps live in den (`detectSetup` in `apprun.ts`). The
  header's **⚙ set up** button (`SetupButton`, only in an added worktree,
  pink when needed) runs it in a new shell tab like ▶ run. "Needed" = a plain
  path from the repo's `.worktreeinclude` (Claude Code's list of gitignored
  files a worktree should get) that the main checkout has and this worktree
  lacks; `node_modules` only for a repo with no `.worktreeinclude`, since
  runn's setup copies it only on request. A listed path whose parent the
  worktree lacks is skipped: runn's `.worktreeinclude` still names its old
  `services/` layout, which a leftover dir in the main checkout matched, so
  the button never cleared. The button chains the **dependency step** after
  setup (`then`, `setupScript`): `runn up` for runn, whose dependencies live
  in its Docker stack (host `node_modules` is an empty mount point), else
  `<pm> install` while `node_modules` is missing. runn is detected from the
  main checkout's `.runn/project.env` too (`isRunnRepo`), since a fresh
  worktree has none until its first `runn up`; without that, ▶ run offered a
  host `turbo:dev`. Two full runn stacks can't run at once (a fixed jaeger
  port), so `runn up` fails while another worktree's stack is up. The workspace pane's system prompt
  gets `setupHint`: the command and whether the worktree looks set up, so
  Claude suggests it when something fails for environment reasons. A my-PR
  pane (your own PR, opened from GitHub) gets the same buttons and hint. Setup is
  per worktree (several of the maintainer's were never set up), so it's a
  button, not a one-time step.
- **Clean up the work repo with Claude** (issue 29): the rail's beaver button (Beaver, the clean-up worker)
  (`openCleanup` in App) opens one Claude workspace in the work repo's main
  checkout (sentinel ticket `den:cleanup`, reused like the den editor) whose
  first message is `cleanupPrompt(skill)` (`prompts.ts`). **The procedure is
  not in den** (den is public, and it depends on one person's tooling): the
  prompt names a personal Claude Code skill — `$DEN_CLEANUP_SKILL` → the
  `cleanup_skill` setting → the one installed `~/.claude/skills/*-cleanup`
  (`pickCleanupSkill`, `server/cleanup.ts`); the maintainer's is
  a team cleanup skill. With none, the prompt carries the generic rules itself
  (squash merges, no `--force`/`--hard`, never the main checkout). Either way
  **plan first and change nothing until approved** is in den's prompt, not
  left to the skill. Verified live: the session invoked the skill, ran its
  audit, returned a three-group plan, and stopped.
- **Edit den itself**: the far-left topbar fox head is a button (`openDenEditor`)
  that opens a normal 3-pane Claude workspace rooted in den's own source
  (`denRepo()` in `fs.ts` → `roots().den`), notepad seeded with a handover +
  Claude primed to read CLAUDE.md. Race-safe reuse via the sentinel ticket
  `"den:self-edit"` (one editor at a time); the kit (and the 🧹 button,
  `reopenSentinel` in App) restarts an **exited** one rather than making a
  new one, since every pane comes back exited after den restarts. The
  editor's **handover outlives its workspace**: closing it moves the notepad
  to `~/.den/carry/self-edit.md` (not under `progress/`, which Fox reads),
  and the next editor's `create()` starts from it (`takeCarried`); an
  untouched template isn't carried. Both fix a lost handover (2026-10-30):
  after a restart the kit opened a fresh editor, and closing the old one
  deleted the real handover. The app/dock icon is the same
  fox head (`scripts/make-icon.cjs` → `build/icon.png` → `icon.icns`).
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
  branch. Sessions are named `ABC-123: title` / `PR #123: title`.
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
- **Inline comments → Claude** (your PRs). The my-PR info pane has a *Handover* tab
  (see Data model) and **two PR tabs** (`PrMyView`): *Description & comments* (description + top-level reviews/comments)
  and *Inline comments* — line-level review comments grouped by file, each rendered
  **with the diff hunk it points at** (anchored line marked) so you see the code
  it's about. Every review / comment / inline comment has a **"→ Claude"** button
  that pastes a framed instruction (author, `file:line`, body, diff hunk) into
  the session's Claude prompt via `POST /api/sessions/:id/paste` (bracketed
  paste — keeps multi-line as one entry, does **not** auto-submit: you read it,
  then press Enter).
- **Post to GitHub from den** (issue 16), always one explicit click on
  content you've just seen, and always from den's **own server code** — a
  review session still can't post (its deny backstop is untouched). Review
  tab → **post to GitHub…** opens `PostReviewDialog`: pure `buildReviewPost`
  (`reviewPost.ts`) turns each review bullet whose `path:line` is **inside
  the diff** into an inline comment (GitHub 422s the whole review if one
  isn't) and puts the rest in the editable body under its file's name; pick
  comment / request changes / approve; non-ASCII characters are counted and
  flagged. On your PRs' **Inline comments** tab, each unresolved thread has
  `ThreadActions`: ↩ reply (REST `.../comments/<first comment id>/replies`)
  and ✓ resolve (GraphQL `resolveReviewThread`, confirm step). The thread
  query now fetches the thread `id` and comments' `databaseId`. Routes:
  `POST /api/github/pr/review-submit | reply | resolve`, inputs validated
  server-side; GitHub's own error line (e.g. "line must be part of the
  diff") is passed back so you can fix it.
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

- **Comments say why, and only what you verified** (andria, 2026-09-29): no
  restating the code, no narrating the change or your own fixes, no asides or
  TODOs, one sentence unless something breaks silently without it. Den tells
  the sessions it spawns the same (`commentRules()` in `instructions.ts`, appended
  wherever `testingRules()` is), and the rule says it beats Claude Code's own
  "match the surrounding comment density", which this comment-heavy repo would
  otherwise pull the wrong way. Existing comments aren't rewritten in passing.
- **Light and dark** (2026-11-06): the topbar's toggle (`ThemeToggle.tsx`)
  sets `data-theme` on the root and remembers it (`den.theme`); until then
  den follows the system. Each dark block in `theme.css` is written twice:
  under `prefers-color-scheme: dark` for `:root:not([data-theme="light"])`,
  and for `:root[data-theme="dark"]`. New dark rules need both, and they
  set **tokens on the root only**: a component selector behind a theme
  prefix outranks its own variants (`.pr-badge.draft`) and once wiped every
  badge's fill in dark mode. Pastels (`--pink`, `--mint`...) are fills with
  dark ink in both themes; accent text uses `--accent-ink`, `--ok-ink`,
  `--warn-ink`, `--info-ink`, `--bad-ink`; neutral chips `--chip-bg`; diffs
  and comment hunks the `--code-*` / `--hl-*` tokens. The topbar is always a
  pastel tint, so its ink stays dark in both. Colours are held to WCAG AA.
- **Terminal theme**: xterm colours live in `web/src/termThemes.ts`. The
  window POSTs its theme to `/api/theme` (`server/paneTheme.ts`, saved in
  `DATA_DIR/theme.txt`) and `paneSettings` passes it as Claude Code's
  `theme`, with `COLORTERM=truecolor` in the pane env. Claude Code reads the
  theme once at launch (a changed `--settings` file is not picked up,
  checked 2026-11-06), so `DenSession.termTheme` records what each pane
  started in; its xterm keeps those colours, and the header shows a
  sun or moon chip (its theme) until it restarts. Shell panes follow the window.
- **Pixel art**: render via canvas + `image-rendering: pixelated` at an *integer*
  pixel scale; animate with `steps()` (fractional transforms/offsets blur it).
- **Hover tips** (`HoverTip.tsx`, mounted once in App): den's window never
  shows native `title` tooltips, so one window-fixed tip shows any element's
  `title` after 400ms (the `.attn-tip` look, neutral border). It moves the
  title to `data-den-title` while shown so a browser with native tooltips
  doesn't show two, and puts it back on leave/mousedown/blur unless a
  re-render set a newer one. So `title` is the way to explain a control;
  the branch chip's is the full branch name.
- **Terminal links and reconnect** (issues 41, 42): `useTerminal` makes
  URLs (web-links addon, plus `linkHandler` for OSC 8) and absolute/`~`
  paths (`PATH_RE` link provider) open on **Cmd/Ctrl+click**. Paths go to
  `POST /api/open-path` -> `openArgs` (`server/openPath.ts`, tested):
  only under `$HOME` or Claude's `/tmp/claude-<uid>/` scratchpads, viewable
  types open, anything else is only revealed in Finder (`open -R`), since
  `open` on a `.command` or `.app` would run it. The socket reconnects on
  close (backoff to 5s, `term.reset()` before the replayed scrollback) and
  is pinged (`ping`/`pong` in `ws-protocol.ts`) on visibilitychange,
  focus, and online, reconnecting if no pong in 2s - after the screen
  slept, input went nowhere until the session was switched away and back.
  Verified by restarting the server under an open terminal: it reattached
  and showed the session as exited without a switch. A real sleep wasn't
  reproduced.
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
  as failing forever (hit on a real PR: 116 rollup rows vs 99 real
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
**Security review, 2026-11-06 (wolf).** Fixed then: `escapeHtml` escapes
quotes (a link's URL from a PR or ticket could add an `onmouseover`); the
server sends a CSP with the UI (`CSP` in `app.ts`: no inline or foreign
script); a request's Origin must be den's own page (`req.socket.localPort`)
or, without a built UI, the Vite dev page (`DEV_ORIGINS`), not any loopback
page; every pane's settings `ask` before `gh issue create|comment|edit` and
deny reading `den.db*` (`paneSettings`), and `denIssueRule` drafts an issue
for the developer to approve; review panes no longer auto-allow `rg`,
`git grep`, or `git fetch` (each can run a command via a flag), line
questions only `git blame` of git; relayed approvals and run / CI output are
called data, not instructions; `~/.den` is mode 700. Open: the Linear key in
plain text in `den.db` (Keychain via `safeStorage` would be better), Fox's
relay token is still text a compromised Fox could write (den carrying the
developer's answers itself would close it), and `git log/show/diff
--output` in the review pane's allow list.

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
  1. **The instruction** (`reviewInstruction` in `instructions.ts`) — the primary
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
  **"Work on it yourself"** (`owned`, a sessions column) lifts both layers
  for one review pane, when the developer takes someone else's PR on: the
  PR dialog's checkbox, or the header's `OwnPrToggle`
  (`POST /api/sessions/:id/owned` -> `setOwned`, which kills a running pane
  and restarts it into the same conversation, since the rules live in its
  system prompt and settings file). `reviewInstruction(..., owned)` swaps
  the never-commit rules for "commit, push, and post when asked" plus
  `houseRules`/`testingRules`/`commentRules`; the guide and review
  deliverables stay. `buildReviewPermissions(..., owned)` empties `deny`.
  Taken on, the pane **works like a workspace** (andria, 2026-11-06: devs
  increasingly finish PRs a product person or an agent opened):
  `worksLikeWorkspace` (`shared/handover.ts`) counts it wherever a workspace
  counts - a handover at the notepad path (`progressInstruction`, so the
  digest, waiting items, idle handover, Hedgehog, start fresh, and the pin
  all apply), `managerRelayRule`, `denWatchRule`, `crewRule` with
  `kitAgents` (not "you are Owl"), `setupHint`, the developer's own
  permission mode (no `--permission-mode default`), the stack check, and
  the ▶ run / ⚙ set up buttons; it's drawn as a kit. `PrReviewView` with
  `work` adds Handover (default), Description & comments, Inline comments,
  and Terminal (App's `renderShells`) tabs to Guide / Review, so the review
  stays a click away without taking the space. Every review pane gets
  `inboxHooks`, since `tellAboutPr` queues CI messages for review panes too.
  The `allow` list is the review file and the guide file (`Edit(//<review>)`,
  plus the handover when taken on,
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

- **Bug buster routes** (`/api/bugs/*`) are reachable by curl from any
  pane, like the other routes: the worst a pane can do is point bug buster
  at another project, assign open unstarted bugs to the developer, or start
  bug sessions whose first message is den's own text. Fox's `Workflow` allow
  covers any workflow, not only `den-bugs.js`. A session named after a
  ticket or PR title elsewhere can still be called "Fox"; only bug buster
  guards against it.

### Verifying changes (how this project has been tested)
`npm run check` (typecheck + eslint + vitest) is the automated gate.
**`npm run smoke`** (`scripts/smoke.cjs`, issue 21) is the end-to-end one: it
builds the UI, boots a server on a throwaway data dir (idle handovers off, the
surrounding `CLAUDE*` env stripped), loads it in a headless Electron window,
opens a shell from the rail, and checks the rail lists it, the terminal
attaches, a typed command's output comes back (`echo den-smoke-$((6*7))` →
`42`, so the echo can't pass for the result), and closing from the rail
removes it; then it starts a Claude workspace on the stub Claude and checks
its args carry den's system prompt. Prints each step, exits 1 naming the one that failed. Needs the
sandbox disabled (it runs fine right after `npm run app` now). Run it after
touching sessions, the WebSocket, or the rail. Close from the **rail**, not
the API: the rail's poll only merges rows it already has, so it never drops
one closed elsewhere. **Tests**
live next to their source as `*.test.ts` (`server/*.test.ts`, `web/*.test.ts`)
and cover the pure, rule-heavy logic — the loopback guard, PR attention rules,
branch validation, path sandbox, title tidy, fox pose. Keep new pure logic
testable (export it), but **add a test only for important, core behaviour**
(andria's rule, 2026-09-29): no low-value tests, nothing another test already
covers, and no tests pinning a fix to your own mistake or a review follow-up
unless that change has become a core part of the functionality (be
conservative about calling it core).
Tests cost time on every run; KISS. Den tells the Claude sessions it spawns
the same (`testingRules()` in `instructions.ts`, appended to workspace and my-PR
panes). Beyond that, verification is scripted + visual:
- Run an **isolated** server: `npm run test-server -- [--port 4399] [--dir <data dir>]`
  (`scripts/test-server.mjs`: its own data dir and db, idle handovers off,
  `CLAUDE*` env stripped, and `scripts/stub-claude` as `claude` via
  `MC_CLAUDE_BIN` unless `--real-claude`; the stub records each pane's args
  and typed input under `<data dir>/stub-claude/`). By hand it's
  `DEN_DATA_DIR=<tmp dir> DEN_DB=<tmp>/den.db PORT=4399 npm run start`
  (node ABI). `DEN_DB` alone isolates only the database: notepads, review
  files, and the `manager/` files are still the installed app's, and a
  test once overwrote the running app's Fox settings and digest that way.
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

Worth knowing before you touch the session code:

- **Issues 1-8** (fixed 2026-09-28) were one bug in different places: the
  prompts den injects disagreed about ASCII, about where a session should
  write its answer, and about what a restarted, my-PR, or look pane knows.
  The fix is the pattern to keep: every server instruction comes from one
  builder shared by create + restart, every client prompt lives in
  `web/src/prompts.ts`, and a test asserts each is ASCII.
- **Issues 22 and 26** (base branch): new branches come off the repo's
  resolved base branch (see `baseRef` under Architecture), a review pane's
  scratch branch is told to start from the PR's checked-out code, and a
  ticket can be **stacked** on another: the ticket dialog and New Session's
  "new workspace" step have a "start from" picker (`BasePicker`, candidates
  from pure `stackCandidates` in `stackBase.ts`) listing your other open
  worktree branches. The create route's `base` goes to `prepareWork`'s
  `stackOn`, which uses the **local** branch, not `origin/`, because the
  ticket you stack on usually has unpushed commits. Linear parent/sub-issue
  order isn't used yet.

Full narrative history is in the git log; user-facing run notes in `README.md`.
