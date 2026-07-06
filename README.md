# 🦊 den

A cozy cockpit for Claude-driven development. One pastel home base for all your
Claude Code sessions, tied to their GitHub PRs and Linear tickets — instead of
juggling terminal tabs.

Status: **v1 (in progress)** — persistent, server-owned Claude sessions
(rename/recolour, scrollback-on-switch) with a live GitHub PR panel (checks,
review status, ticket hints).

## Run

### As a desktop app (Electron)

```bash
npm install
npm run app      # rebuilds native modules for Electron, builds, and launches
```

A native window opens (dock icon, own window). The Node server runs inside
Electron's main process on an ephemeral port, so it never clashes with the dev
server. Session data lives in `~/.den/den.db`.

### In the browser (fast dev loop)

```bash
npm run rebuild:node   # only needed after running the app (see ABI note below)
npm run dev            # server on :4321, web on :5173 — open the latter
```

> **Native module ABI note:** `node-pty` and `better-sqlite3` are native and
> must match their runtime. `npm run app` rebuilds them for Electron;
> `npm run rebuild:node` rebuilds them for plain Node (browser dev). Switch with
> those two commands when moving between the app and browser dev.

## Layout

- `server/sessions.ts` — owns long-lived PTYs (Claude Code via `claude -n`),
  independent of any WebSocket, with a per-session scrollback buffer that
  replays on (re)attach.
- `server/store.ts` — better-sqlite3 persistence of session metadata
  (`~/.den/den.db`).
- `server/github.ts` — live PR data via the `gh` CLI.
- `server/app.ts` — Fastify app factory (`startServer()`): session REST
  (`/api/sessions`), filesystem browsing (`/api/fs/*`), GitHub PRs, and the
  attach-by-id terminal WebSocket (`/ws/terminal?id=`). Shared by the CLI and
  the desktop app.
- `server/index.ts` — thin CLI entry that calls `startServer()`.
- `electron/main.ts` — Electron main process; runs `startServer()` in-process
  and opens the window. Bundled to `dist/electron/main.cjs` by esbuild.
- `web/` — Vite + React + xterm.js. 3-pane cockpit (`web/src/App.tsx`,
  `web/src/WorkPanel.tsx`, `web/src/NewSessionDialog.tsx`).
- `server/ws-protocol.ts` — typed messages shared by both sides.

## Roadmap

- **v1** — ✅ GitHub PR panel · ✅ persistent multi-session manager
  (rename/recolour, scrollback on switch) · ⬜ Linear ticket panel.
- **v2** — workspace linking (ticket ↔ worktree ↔ PR ↔ session), quick actions.
- **v3** — notifications, pixel-art polish, optional Tauri desktop packaging.

See the full plan at `~/.claude/plans/reactive-forging-plum.md`.
