import * as pty from "node-pty";
import os from "node:os";
import type { ClientMessage, ServerMessage } from "./ws-protocol.ts";

// Which shell/program to spawn. For v0 we spawn `claude` directly so the
// browser terminal *is* a Claude Code session. Falls back to the login shell.
const CLAUDE_BIN = process.env.MC_CLAUDE_BIN ?? "claude";

export interface SpawnOptions {
  name: string;
  cwd: string;
  /** Extra args after the implicit `-n <name>`. */
  args?: string[];
  /** Spawn a plain shell instead of claude (useful for debugging). */
  shell?: boolean;
}

/**
 * Spawns a PTY (Claude Code session by default) and wires it to a WebSocket-ish
 * sink. `send` delivers ServerMessages to the browser; the returned handle lets
 * the caller feed ClientMessages in and dispose the process.
 */
export function spawnSession(
  opts: SpawnOptions,
  send: (msg: ServerMessage) => void,
) {
  const shell = process.env.SHELL ?? "/bin/zsh";
  const file = opts.shell ? shell : CLAUDE_BIN;
  const args = opts.shell ? [] : ["-n", opts.name, ...(opts.args ?? [])];

  const term = pty.spawn(file, args, {
    name: "xterm-color",
    cols: 80,
    rows: 24,
    cwd: opts.cwd || os.homedir(),
    env: { ...process.env, TERM: "xterm-256color" },
  });

  send({ type: "ready", pid: term.pid });

  term.onData((data) => send({ type: "output", data }));
  term.onExit(({ exitCode, signal }) =>
    send({ type: "exit", code: exitCode, signal }),
  );

  return {
    pid: term.pid,
    handle(msg: ClientMessage) {
      if (msg.type === "input") term.write(msg.data);
      else if (msg.type === "resize") {
        // Guard against zero/NaN dimensions which crash node-pty.
        const cols = Math.max(1, Math.floor(msg.cols) || 80);
        const rows = Math.max(1, Math.floor(msg.rows) || 24);
        term.resize(cols, rows);
      }
    },
    dispose() {
      try {
        term.kill();
      } catch {
        // already dead
      }
    },
  };
}
