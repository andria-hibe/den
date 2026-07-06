# 🦊 den

A cozy cockpit for Claude-driven development. One pastel home base for all your
Claude Code sessions, tied to their GitHub PRs and Linear tickets — instead of
juggling terminal tabs.

Status: **v1 (in progress)** — Claude sessions stream into the browser, and the
right panel shows your live GitHub PRs (checks, review status, ticket hints).

## Run

```bash
npm install      # postinstall fixes node-pty's spawn-helper exec bit
npm run dev      # server on :4321, web on :5173 (open this)
```

Open http://localhost:5173. Use **+ claude** to spawn a Claude Code session or
**+ shell** for a plain shell. Type, resize, and switch between sessions.

## Layout

- `server/` — Fastify + WebSocket + `node-pty`. Spawns `claude -n <name>` and
  streams it to the browser (`server/pty.ts`, `server/index.ts`).
- `web/` — Vite + React + xterm.js. 3-pane cockpit (`web/src/App.tsx`).
- `server/ws-protocol.ts` — typed messages shared by both sides.

## Roadmap

- **v1** — ✅ GitHub PR panel · ⬜ persistent multi-session manager
  (rename/recolour, scrollback on switch) · ⬜ Linear ticket panel.
- **v2** — workspace linking (ticket ↔ worktree ↔ PR ↔ session), quick actions.
- **v3** — notifications, pixel-art polish, optional Tauri desktop packaging.

See the full plan at `~/.claude/plans/reactive-forging-plum.md`.
