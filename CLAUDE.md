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
  review-requested → `isMine`), `getPrDetail` (body + reviews/comments),
  `getPrDiff`, and `reviewPr` (headless `claude -p` fed the diff → markdown).
- `server/linear.ts` — Linear GraphQL (`@linear/sdk` not used; raw fetch).
  Assigned issues + `branchName` + `description`. Key in the settings table or
  `LINEAR_API_KEY`. **Linear = runn only.**
- `server/git.ts` — `prepareWork` (ticket branch: worktree or local, off a fresh
  `origin/master`), `checkoutPr` (`gh pr checkout` into a worktree or local), and
  `worktreeForBranch` (reuse an existing worktree instead of erroring).
- `server/discover.ts` — lists past Claude sessions from
  `~/.claude/projects/**/*.jsonl` (for resume).
- `server/fs.ts` — home-sandboxed directory browsing + `roots()`
  (documents / work / **runn** / projects).
- `web/src/App.tsx` — the whole UI: 3-column flex layout, session rail, center
  (terminal / 3-pane claude workspace / look / PR review / my-PR), work panel,
  all dialogs + handlers. Big file; most wiring lives here.
- `web/src/` components: `WorkPanel` (Linear + GitHub cards), `LinearPanel`,
  `TicketDialog`, `PrDialog`, `PrViews` (PrReviewView/PrMyView), `DiffView`,
  `NotepadPane`, `NewSessionDialog`, `Fox`/`foxSprites` + `PixelFox`, `Splitter`,
  `useTerminal`, `markdown.ts`, `theme.css`.

## Data model

A **session** = one PTY (`DenSession`) with `groupId` + `role` ("main"|"shell").
- **Claude workspace** = a `main` claude pane + a `shell` pane (same group) + a
  progress notepad file at `~/.den/progress/<groupId>.md`.
- **shell** session = a single plain terminal.
- **Single-pane claude** sessions carry a `view`: `look` (ticket + claude),
  `review` (others' PR), `mypr` (your PR), or a ticket-look. They also carry
  `ticket` / `pr` / `prRepo` / `branch` for linking.
The rail shows only `role === "main"`. The frontend polls `/api/sessions` (~4s)
to sync names/status/attention.

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
- **Reactive pixel-art fox**: topbar status fox from GitHub PR health
  (happy/alert/sit); sleeping fox (drifting z) in the empty state; walking fox in
  loading rows. Sprites in `foxSprites.ts`; keep integer scale + stepped
  animation or they blur.
- **Work panel**: Linear tickets + GitHub PRs, with ↗ open-in-browser links.
- **Session ↔ branch ↔ ticket ↔ PR linking**: chips in the workspace header and
  on rail cards (matched via the `fast-NNNN` branch hint + explicit ids).
- **Resume** past Claude sessions from `~/.claude/projects`.
- **Attention nudges**: a background session that rings the bell shows a pulsing
  `!`; cleared when you view it.
- **Linear ticket → Look / Work**. Work creates the branch (worktree or local),
  seeds the notepad with a ticket summary, and **primes Claude** with the ticket
  to explain the issue + propose a solution before coding. Look = ticket detail
  (markdown) + a Claude pane.
- **GitHub PR → Review / Edit**. Others' PRs: check out into a worktree, show the
  diff + description + optional headless Claude review + a Claude session. Your
  PRs: description + colleagues' reviews/comments + a Claude session on the
  branch. Sessions are named `FAST-1234: title` / `PR #123: title`.
- **Reuse everywhere**: clicking a ticket/PR reuses an existing session; branches
  and worktrees (incl. Claude Code's own `.claude/worktrees/`) are reused, never
  duplicated. Error toasts surface any failure.
- **Electron app** with a rendered fox `.icns`.

## Conventions & gotchas (hard-won)

- **Pixel art**: render via canvas + `image-rendering: pixelated` at an *integer*
  pixel scale; animate with `steps()` (fractional transforms/offsets blur it).
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
  `webContents.capturePage()` (see `scripts/shot.cjs`); drive clicks via
  `executeJavaScript`. **Read the PNG back to eyeball it.** Keep window width so
  the 2× capture stays < 2000px to avoid the harness downscaling (blurs pixels).
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
2. **My-PR (Edit) flow** is only lightly exercised — do a full click-through:
   description+comments render, branch checks out/reuses, Claude can push changes.
3. **Feed Linear ticket status into the fox** too (topbar fox is GitHub-only).
4. **Worktree lifecycle**: offer to remove Den-created worktrees
   (`runn/.claude-worktrees/pr-*`) when closing a session; list/adopt existing
   ones.
5. **Post reviews back to GitHub** (`gh pr review/comment`) from the review view.
6. **Persistence**: `view`/`ticket`/`pr` are in-memory only — persist them so the
   rail restores full context after a server restart (columns like groupId/role
   already migrate in `store.ts`).
7. **Keyboard shortcuts** (new session, switch 1–9, close) + window-state memory;
   maybe a menu-bar mode.
8. **Native notifications** for attention (bell) and PR check failures.
9. **Token awareness**: headless PR review + progress logging spend tokens — add
   visible toggles / cost hints.
10. **Diff view**: syntax highlighting + collapsible files; **notepad**: auto-
    scroll to newest.
11. **Dual-ABI friction**: consider shipping prebuilt binaries for both Node and
    Electron so `dev` and `app` don't need rebuilds when switching.
12. **Tests**: add a real suite (the scripted checks above are ad-hoc).

Full narrative history is in the git log; user-facing run notes in `README.md`.
