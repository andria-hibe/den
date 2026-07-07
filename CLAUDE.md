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
  review-requested → `isMine`); `getPrDetail` (body + reviews + issue comments +
  **inline review comments** with `path`/`line`/`diffHunk`, fetched via
  `gh api .../pulls/N/comments` since `pr view` omits them); `getPrDiff`;
  `reviewPr` (headless `claude -p` fed the diff → markdown, via `claudePrint`);
  and `summarizePrDiff` (headless `claude -p` → `[{file, summary}]` JSON, one
  line per file, for the review diff's side column).
- `server/linear.ts` — Linear GraphQL (`@linear/sdk` not used; raw fetch).
  Assigned issues + `branchName` + `description`. Key in the settings table or
  `LINEAR_API_KEY`. **Linear = runn only.**
- `server/git.ts` — `prepareWork` (ticket branch: worktree or local, off a fresh
  `origin/master`), `checkoutPr` (`gh pr checkout` into a worktree or local), and
  `worktreeForBranch` (reuse an existing worktree instead of erroring).
- `server/discover.ts` — lists past Claude sessions from
  `~/.claude/projects/**/*.jsonl` (for resume). Titles each from its `summary`
  or first real user message; **drops** den's own headless `claude -p` helpers
  (PR diff-summary / review prompts) and empty/aborted sessions (no summary +
  no user prose), and scans past the limit to still fill it after skips.
- `server/fs.ts` — home-sandboxed directory browsing + `roots()`
  (documents / work / **runn** / projects).
- `web/src/App.tsx` — the whole UI: 3-column flex layout, session rail, center
  (terminal / 3-pane claude workspace / look / PR review / my-PR), work panel,
  all dialogs + handlers. Big file; most wiring lives here.
- `web/src/` components: `WorkPanel` (Linear + GitHub cards), `LinearPanel`,
  `TicketDialog`, `PrDialog`, `PrViews` (PrReviewView/PrMyView), `DiffView`,
  `NotepadPane`, `NewSessionDialog`, `Fox`/`foxSprites` + `PixelFox`, `Splitter`,
  `useTerminal`, `markdown.ts`, `theme.css`.
  - `DiffView.tsx` exports `classify(line)` (diff-line CSS class) + `DiffHunk`
    (renders one `diff_hunk`, marks the anchored last line) besides `DiffView`
    (per-file blocks: summary column left, diff right).
  - `PrViews.tsx`: `PrReviewView` (others' PRs — diff + per-file summaries +
    Claude review); `PrMyView` (your PRs — description, top-level `Notes`, and
    `InlineComments`: line-level comments grouped by file, each shown with its
    diff hunk); `ToClaude` button pastes a framed instruction into the session.

## Data model

A **session** = one PTY (`DenSession`) with `groupId` + `role` ("main"|"shell").
- **Claude workspace** = a `main` claude pane + **one or more `shell` panes**
  (same group, shown as tabs) + a progress notepad at `~/.den/progress/<groupId>.md`.
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
  loading rows. Sprites in `foxSprites.ts`; keep integer scale + stepped animation
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
- **GitHub PR → Review / Edit**. Others' PRs: check out into a worktree, show the
  diff + description + optional headless Claude review + a Claude session. The
  review diff is grouped per file with a **left summary column** (headless Claude
  one-liner per file) aligned to each file's block, so you can scan changes at a
  glance. Your PRs: description + colleagues' reviews/comments + a Claude session
  on the branch. Sessions are named `FAST-1234: title` / `PR #123: title`.
- **Inline comments → Claude** (your PRs). The my-PR info pane has **two tabs**
  (`PrMyView`): *Description & comments* (description + top-level reviews/comments)
  and *Inline comments* — line-level review comments grouped by file, each rendered
  **with the diff hunk it points at** (anchored line marked) so you see the code
  it's about. Every review / comment / inline comment has a **"→ Claude"** button
  that pastes a framed instruction (author, `file:line`, body, diff hunk) into
  the session's Claude prompt via `POST /api/sessions/:id/paste` (bracketed
  paste — keeps multi-line as one entry, does **not** auto-submit).
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
- **git commits sign via 1Password** (`commit.gpgsign=true`, ssh). If it's locked
  the commit fails with "1Password: failed to fill whole buffer" — retry when
  unlocked, or `--no-gpg-sign` and re-sign later. Commit trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **runn workspace** has its own Claude rules/setup — always work inside runn
  (`~/Documents/work/runn`) or a worktree of it for Linear/PR work.

### Verifying changes (how this project has been tested)
No automated suite yet — verification is scripted + visual:
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
  `summarizePrDiff`, the paste endpoint) with a short Node fetch script on an
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
8. **Native notifications** for attention (bell) and PR check failures.
9. **Token awareness**: headless PR review + progress logging spend tokens — add
   visible toggles / cost hints.
10. **Diff view**: now grouped per file with a Claude summary column (review) and
    per-comment hunks (my-PR). Still missing: syntax highlighting + collapsible
    files. **Notepad**: auto-scroll to newest.
11. **Dual-ABI friction**: consider shipping prebuilt binaries for both Node and
    Electron so `dev` and `app` don't need rebuilds when switching.
12. **Tests**: add a real suite (the scripted checks above are ad-hoc).

Full narrative history is in the git log; user-facing run notes in `README.md`.
