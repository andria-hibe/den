# 🦊 den — project guide for Claude

Den is a cozy personal cockpit for Claude-driven development: one pastel,
pixel-art Electron app where andria (senior dev @ runn) runs many Claude Code
sessions, each tied to its GitHub PR and Linear ticket. This file is the short
index every session loads. **The full notes are in `docs/architecture.md`**:
read the section for the area you're changing before you change it, and keep
it current (sections: Run / build, den v2, Architecture, Data model, Features,
Conventions & gotchas, Security posture, Verifying changes, Backlog).

## Run / build

```bash
npm install            # postinstall restores node-pty's +x bit
npm run dev            # server :4321 + Vite :5173 (open :5173)
npm run app            # Electron, building native/ for Electron first
npm run pack           # release/mac-arm64/Den.app (unsigned, local)
npm run check          # typecheck + lint + test: run before committing
npm run smoke          # real server + UI + a stub Claude pane, headless Electron
npm run test-server -- --port 4399 [--dir <data dir>]   # isolated server, stub claude
```

- **Don't repackage or reinstall unless andria asks.** They control when the
  running app is replaced, and the bundle may only be swapped **while den is
  quit** (a running den execs node-pty's spawn-helper from it). The topbar's
  "⬆ update" (`server/denUpdate.ts`) is the developer's own click for this.
- `node_modules` is always built for Node; only `better-sqlite3` gets an
  Electron copy in `native/` (`npm run native:electron`). No switching.
- Data lives in `~/.den` (`server/dataDir.ts`; `DEN_DATA_DIR` overrides). Never
  run the Burrow -> den data move (`electron/adoptBurrow.ts`) from server code.

## Map

- `electron/main.ts`: Electron entry; runs `startServer()` in-process.
- `server/app.ts`: `startServer()` and every route. `server/sessions.ts`:
  `SessionManager` / `DenSession` (PTYs, scrollback, rail state, handovers,
  clock out, turn state). `server/instructions.ts`: **every pane's system
  prompt and permission rules, one builder per pane kind**, shared by create
  and restart. `server/paths.ts`: shared paths.
- Fox and the day: `manager.ts`, `digest.ts`, `pickup.ts`; crew subagents:
  `crew.ts`, `crewActivity.ts`; checks workflow: `doneCheck.ts`; token watch:
  `fieldMouse.ts`, `limits.ts`, `usage.ts`, `shared/pace.ts`; turn hooks:
  `turnState.ts`; inbox to panes: `inbox.ts`; line questions: `lineAsk.ts`.
- GitHub `github.ts` (gh CLI, one GraphQL search), Linear `linear.ts`, git and
  worktrees `git.ts`, stacks `stack.ts`, app run / set up `apprun.ts`, CI
  watch `ciWatch.ts`, store `store.ts` (sqlite), fs sandbox `fs.ts`.
- Web: `App.tsx` (composition root), `useSessions.ts`, `SessionRail.tsx`,
  `PrViews.tsx` / `PrGuide.tsx` / `DiffView.tsx` (review), `TodayView.tsx`
  (Fox), `CrewButtons.tsx`, `prompts.ts` (**every client prompt**),
  `theme.css`. `shared/` holds what both sides import.

## Rules that break things silently

- **Prompts:** every server prompt comes from a builder in `instructions.ts`
  (or its module, e.g. `doneCheck.ts`), every client prompt from
  `web/src/prompts.ts`, and a test holds each to **plain ASCII**. A new pane
  kind gets its own builder. Every pane's `--settings` comes from
  `paneSettings` in `sessions.ts`.
- **A resumed conversation keeps the system prompt it started with** until it
  compacts; only start fresh picks up changed instructions (the "old
  instructions" chip flags it).
- **Never type into a live pane on den's own initiative** (a pane at a
  permission prompt looks idle): use the inbox (`sessions.tell`) or a headless
  fork. `paste` with `submit` only on an explicit user action.
- **CI comes from `gh pr checks --json bucket`, never `statusCheckRollup`**
  (it keeps superseded failures). `gh pr checks` exits 1/8 with valid JSON:
  call it via `ghAllowFail`.
- **The session poll only merges rows it has**: code that creates a session
  out of band refetches the full list.
- **Review panes never commit, push, or post** (instruction + deny backstop in
  `buildReviewPermissions`); "Work on it yourself" (`owned`) lifts both.
- **den is public; the work repo isn't.** den issues (`gh issue create --repo
  andria-hibe/den`), prompts, docs, tests, and commit messages name no
  work-repo code, people, tickets, or skill names; prompts refer to the work
  repo's skills by role only ("its performance skill, if it has one").
- **Pixel art:** integer scale, `image-rendering: pixelated`, `steps()`
  animation. **xterm:** never pad the element FitAddon measures. **Hover
  tips:** use `title` (HoverTip shows it). **OSC titles:** Claude panes only.
  **Dark rules** go in twice: under `prefers-color-scheme: dark` for
  `:root:not([data-theme="light"])`, and for `:root[data-theme="dark"]` (the
  topbar's light / dark toggle).
- **Isolated testing:** `DEN_DB` alone isolates only the database; use
  `npm run test-server` or `DEN_DATA_DIR`. Don't test Fox on an isolated
  server against real sessions (`ListAgents` is real). In this sandbox,
  Electron / gh / claude / git need the sandbox disabled. zsh chokes on UUIDs
  in `$(...)`: script multi-step API tests in Node. `scripts/shot.cjs` takes a
  bare `SHOT_OUT` file name (it writes under `build/`).
- **Commits** sign via 1Password: a "failed to fill whole buffer" error means
  retry with the sandbox off, then ask andria to unlock it.

## Writing code here

- **Comments say why, and only what you verified**: no restating code, no
  narrating the change, no TODOs, one sentence unless something breaks
  silently without it. This beats matching the repo's comment density.
- **Tests only for important, core behaviour**, next to the source as
  `*.test.ts`; no low-value tests and none pinning a fix to your own mistake
  or a review follow-up. Keep pure logic exported and testable.
- Before saying work is done: `npm run check`, plus `npm run smoke` after
  touching sessions, the WebSocket, or the rail; UI changes get a screenshot
  (static HTML with `theme.css` + `shot.cjs` is the cheap way). Update
  `docs/architecture.md` (and `web/public/architecture.svg` when the
  architecture changes) in the same commit.
- Crew pixel art lives in `critterSprites.ts`; update the gallery artifact
  (https://claude.ai/artifact/5Dn81Siu4mP7Qbu6Jg7RBA) on any sprite or crew
  name change, and keep new crew members forest animals.

## Backlog

GitHub issues: <https://github.com/andria-hibe/den/issues>. Add new work there,
not here.
