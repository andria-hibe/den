// Typed messages exchanged over the terminal WebSocket.
// Shared shape between server (server/pty.ts) and web (src/useTerminal.ts).

/** Messages the browser sends to the server. */
export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

/** Messages the server sends to the browser. */
export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "exit"; code: number | null; signal?: number }
  | { type: "ready"; pid: number };
