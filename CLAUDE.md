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
- `server/store.ts` — `better-sqlite3` at `~/.den/den.db` (sessions + a settings
  table for the Linear key). Session rows are for the rail; live PTYs don't
  survive a restart (marked exited on boot).
- `server/github.ts` — wraps the authed `gh` CLI: PR buckets (authored vs
  review-requested → `isMine`); CI status from **`gh pr checks --json bucket`**
  (deduped to the latest run per check — *not* `statusCheckRollup`; see the CI
  gotcha below) summarized by `summarizeChecks`; `getPrDetail` (body + reviews + issue comments +
  **inline review comments** with `path`/`line`/`diffHunk` + a `resolved` flag,
  fetched via `gh api graphql` **reviewThreads** — the thread carries
  `isResolved`, which the REST comments endpoint omits, so the my-PR UI can hide
  resolved comments); `getPrDiff`; and `reviewPr` (headless `claude -p` fed the
  diff → markdown, via `claudePrint`) — note `reviewPr` / `POST /api/github/pr/review`
  are **currently unused by the UI**: the interactive review session does the
  reviewing now. (`summarizePrDiff`, a second headless pass that produced one-line
  per-file summaries for the review diff's side column, was removed when that
  column became the session's own per-file review comments.)
- `server/linear.ts` — Linear GraphQL (`@linear/sdk` not used; raw fetch).
  Assigned issues + `branchName` + `description`. Key in the settings table or
  `LINEAR_API_KEY`. Scoped to whatever workspace the key belongs to (runn, for
  the maintainer).
- `server/git.ts` — `prepareWork` (ticket branch: worktree or local, off a fresh
  `origin/master`), `checkoutPr` (`gh pr checkout` into a worktree or local), and
  `worktreeForBranch` (reuse an existing worktree instead of erroring).
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
- `web/src/App.tsx` — the whole UI: 3-column flex layout, session rail, center
  (terminal / 3-pane claude workspace / look / PR review / my-PR), work panel,
  all dialogs + handlers. Still the largest file, but the cross-cutting concerns
  now live in their own modules (below).
- `web/src/WorkData.tsx` — **single source of truth** for GitHub PRs + Linear
  issues. A `WorkDataProvider` (mounted in `main.tsx`) polls each endpoint **once**
  (60s) and shares it via `useWorkData()`; App (fox + linking), `WorkPanel`, and
  `LinearSection` all read from it, so they never drift out of phase. Previously
  each polled independently (four loops for two resources).
- `web/src/` hooks/helpers extracted from App: `useRovingFocus` (arrow-key focus
  ring), `useKeyboardShortcuts` (Cmd/Ctrl+N/T/W/1–9), `useNotifications` (native
  OS notifications on attention/PR transitions), `foxPose.ts` (pure
  `deriveFoxPose` + the pose cast/titles), `TerminalView`, `TicketComments`,
  `api.ts` (the fetch wrapper). Each is small and unit-testable where pure.
- `web/src/` components: `WorkPanel` (Linear + GitHub cards), `LinearPanel`,
  `TicketDialog`, `PrDialog`, `PrViews` (PrReviewView/PrMyView), `DiffView`,
  `NotepadPane`, `NewSessionDialog`, `Fox`/`foxSprites` + `PixelFox`, `Splitter`,
  `useTerminal`, `markdown.ts`, `theme.css`.
  - `DiffView.tsx` exports `classify(line)` (diff-line CSS class), `DiffHunk`
    (renders one `diff_hunk`, marks the anchored last line), `lineNumbers(lines)`
    (old/new file line numbers walked from each `@@ -a,b +c,d @@` header — only
    *inside* a hunk, since the `---`/`+++` preamble also starts with `-`/`+`), and
    `diffFiles(diff)` (the paths a diff touches — the keys review comments are
    filed under), besides `DiffView` (per-file blocks: the review's comments for
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
  - `PrViews.tsx`: `PrReviewView` (others' PRs — **two regions, one splitter**, so
    it works on a small screen: a tabbed pane above (**Review** / **Description**)
    and the session below. The Review tab is one scroll region — the general review
    first, then the diff with **each file's review comments beside that file's
    hunks** (sticky, via `parseReview` → `DiffView notes=`). The session is told
    (via `reviewInstruction`) to save its finished review as markdown to the
    workspace notepad `~/.den/progress/<groupId>.md`, structured as general review
    then one `## <file path>` heading per file; the view polls that notepad, so the
    review is shown next to the code it's about *and* kept as a record.
    Review panes carry a notepad — `create()`/`restartArgs` wire it for
    `view === "review"`. **Review panes are locked to strictly read-only** (see
    Security posture): no shell, and the notepad is the only writable path, so a
    review can never touch the PR. Since it has no shell to run `gh pr diff`, den
    fetches the diff (`app.ts`) into `~/.den/review/<groupId>.diff` for the
    session to Read); `PrMyView` (your PRs — description, top-level `Notes`, and
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
  `ticket` / `pr` / `prRepo` / `branch` for linking.
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
(`restartArgs` — a workspace main keeps its `--add-dir`/progress-notepad wiring;
look/PR panes get `-n name`), so restart never re-injects the one-time initial
prompt, and it works even after a server restart wiped the in-memory `spawnArgs`.
The scrollback is cleared (fresh process). The frontend keys each `TerminalView`
by `` `${id}:${status}` `` so the flip to "running" remounts it and reconnects to
the new PTY; restart buttons (`↻`) appear on exited rail rows + in the workspace
header. This is the answer to "live PTYs don't survive a restart" — the row comes
back exited, and one click revives it.

## Features (all built + committed on `master`)

- Multi-session cockpit: create/rename(double-click)/recolour/close; persistent;
  scrollback-on-switch; attach-by-id WebSocket.
- New Session dialog: **Work / Personal / Other / Resume** with a folder browser
  (create folders, type paths). Sessions default to `~/Documents`.
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
  (current one badged "now"); **hover the `den` wordmark** for the keyboard-shortcut
  cheat sheet.
- **PR cards flag what needs you**: cards with `needsAttention` get a pink accent
  + pulsing `!` (tooltip = `attentionReason`), so the "review requested" and "my
  open PRs" sections show at a glance which ones are on you. Already-approved
  review-requested PRs drop the flag (`getMyPullRequests`: `review !== "approved"`).
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
  with **Description / Comments tabs** (`lookTab` state) + a Claude pane; comments
  via `getIssueComments` → `/api/linear/comments` (bot/integration comments show
  their `botActor` name).
- **Linear notifications nudge**: `getAssignedIssues` also returns
  `unreadNotifications` (same GraphQL query); a pink `! N` badge shows in the work
  panel's linear header (links to the workspace inbox) and unread notifications
  push the topbar fox to `alert`.
- **GitHub PR → Review / Edit**. Others' PRs: check out into a worktree, then
  **one tabbed pane above (Review / Description) + the Claude session below** —
  two regions, one splitter (it used to be four panes and three splitters, which
  didn't fit a small screen). The Review tab reads top-to-bottom: the general
  review, then the diff per file with **that file's review comments in the column
  beside its hunks** (sticky, so they stay put while you scroll the code). Your
  PRs: description + colleagues' reviews/comments + a Claude session on the
  branch. Sessions are named `FAST-1234: title` / `PR #123: title`.
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
- **PR-review panes are strictly read-only.** Reviewing someone else's PR must
  never modify their branch, so a `view === "review"` session is spawned with a
  generated per-session settings file (`--settings`, `--permission-mode default`)
  whose `permissions` (`buildReviewPermissions` in `sessions.ts`, unit-tested)
  **deny `Bash`** (no shell → no `git push`/`commit`, no `gh pr` write, no
  `sed -i`/redirects) and **deny `Edit(//<realpath'd-worktree>/**)`** (Edit rules
  gate Write/MultiEdit/NotebookEdit too). A `deny` is a hard block — it can't be
  overridden by an approval prompt. The only writable path is the notepad
  (`allow: Edit(//<notepad>)`, outside the worktree), so the review saves without
  a prompt. Read/Grep/Glob stay available; the diff is handed over as a file to
  Read (`~/.den/review/<groupId>.diff`) since there's no shell to fetch it. (No
  GitHub MCP is configured, so with `Bash` gone there is no tool path to the PR.)
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

## Recommendations / roadmap (revisit next time)

1. **Sign & notarize** the app (currently unsigned `identity: null`) if it'll be
   shared; add auto-update. A couple of recent commits are unsigned (1Password
   was locked) — re-sign if desired.
2. **My-PR (Edit) flow**: comment rendering + inline-comment diffs + "→ Claude"
   are built & verified, but the end-to-end *edit* path (branch checks out/reuses,
   Claude makes & pushes changes) still needs a live click-through with a push.
3. ~~**Feed Linear into the fox**.~~ **Partly done** — unread Linear
   *notifications* now push the fox to `alert`. Still open: reflect Linear ticket
   *status/priority* (e.g. an urgent assigned ticket) in the fox too.
4. **Worktree lifecycle**: offer to remove Den-created worktrees
   (`runn/.claude-worktrees/pr-*`) when closing a session; list/adopt existing
   ones.
5. **Post back to GitHub** (`gh pr review/comment`, resolve threads). The
   "→ Claude" buttons only *hand a comment to Claude* to action locally — they
   don't reply to or resolve the thread on GitHub. Natural next step: let Claude
   post its response / mark the inline comment resolved from Den.
6. ~~**Persistence**: `view`/`ticket`/`pr` are in-memory only.~~ **Done** —
   `branch`/`ticket`/`look`/`view`/`pr`/`prRepo`/`titleLocked` now persist to
   `store.ts` (migrated columns) and restore in `hydrate()`, so the rail renders
   full PR/ticket/look context after a server restart (sessions come back
   `exited`, but their center pane is intact).
7. ~~**Keyboard shortcuts** (new session, switch 1–9, close).~~ **Done** —
   `Cmd/Ctrl+N` new claude · `Cmd/Ctrl+T` new shell · `Cmd/Ctrl+1–9` switch to
   the Nth rail session · `Cmd/Ctrl+W` close the active session (a window
   `keydown` listener in `App.tsx` reading current state via a ref; suppressed
   while a modal/rename is open). Native Cmd+W was freed from Electron's default
   macOS menu by installing a trimmed menu in `main.ts` (`installMenu()` keeps
   Edit/View/appMenu roles, drops the Cmd+W "Close Window" accelerator). Still
   open: window-state memory; maybe a menu-bar mode. **NB in dev-browser Cmd+W
   still closes the tab** — only the packaged app frees it.
8. ~~**Native notifications** for attention (bell) and PR check failures.~~
   **Done** — `web/src/useNotifications.ts` fires OS notifications on
   *transitions* (a background session ringing the bell; a PR newly needing you),
   seeding startup state silently so a launch never spams.
9. **Token awareness**: headless PR review + progress logging spend tokens — add
   visible toggles / cost hints. (One spend removed: the review diff's per-file
   column is now filled by the review session itself, so the separate headless
   `summarizePrDiff` pass is gone.)
10. **Diff view**: grouped per file, with the review's per-file comments beside
    each file (review) and per-comment hunks (my-PR). Still missing: syntax
    highlighting + collapsible files. **Notepad**: auto-scroll to newest.
11. **Dual-ABI friction**: consider shipping prebuilt binaries for both Node and
    Electron so `dev` and `app` don't need rebuilds when switching.
12. ~~**Tests**: add a real suite.~~ **Started** — vitest covers the pure logic
    (`npm test`, 40 cases). Still ad-hoc for UI/integration; consider a
    Playwright/headless-Electron smoke path next.
13. **Scrollback persistence** — the terminal ring is now flushed to a sqlite
    `scrollback` column (every 5s while dirty + on exit) and restored on
    `hydrate()`, so a restart replays recent output instead of an empty pane.
    Live PTYs still don't survive a restart (sessions return `exited`).

Full narrative history is in the git log; user-facing run notes in `README.md`.
