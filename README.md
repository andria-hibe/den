# 🦊 den

A cozy cockpit for Claude-driven development. One pastel home base for all your
Claude Code sessions, tied to their GitHub PRs and Linear tickets — instead of
juggling terminal tabs.

Status: **v1 (in progress)** — persistent, server-owned Claude sessions
(rename/recolour, scrollback-on-switch) with a live GitHub PR panel (checks,
review status, ticket hints).

## Run

```bash
npm install      # postinstall fixes node-pty's spawn-helper exec bit
npm run dev      # server on :4321, web on :5173 (open this)
```

Open http://localhost:5173. Use **+ claude** to spawn a Claude Code session or
**+ shell** for a plain shell. Type, resize, and switch between sessions.

## Layout

- `server/sessions.ts` — owns long-lived PTYs (Claude Code via `claude -n`),
  independent of any WebSocket, with a per-session scrollback buffer that
  replays on (re)attach.
- `server/store.ts` — better-sqlite3 persistence of session metadata (`den.db`).
- `server/github.ts` — live PR data via the `gh` CLI.
- `server/index.ts` — Fastify: session REST (`/api/sessions`), GitHub PRs, and
  the attach-by-id terminal WebSocket (`/ws/terminal?id=`).
- `web/` — Vite + React + xterm.js. 3-pane cockpit (`web/src/App.tsx`,
  `web/src/WorkPanel.tsx`).
- `server/ws-protocol.ts` — typed messages shared by both sides.

## Roadmap

- **v1** — ✅ GitHub PR panel · ✅ persistent multi-session manager
  (rename/recolour, scrollback on switch) · ⬜ Linear ticket panel.
- **v2** — workspace linking (ticket ↔ worktree ↔ PR ↔ session), quick actions.
- **v3** — notifications, pixel-art polish, optional Tauri desktop packaging.

See the full plan at `~/.claude/plans/reactive-forging-plum.md`.
