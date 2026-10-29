// Messages over the terminal WebSocket, shared by the server (app.ts,
// sessions.ts) and web/src/useTerminal.ts.

/** Messages the browser sends to the server. */
export type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  /** Is this socket still alive? Answered with "pong" (#42). */
  | { type: "ping" };

/** Messages the server sends to the browser. */
export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "exit"; code: number | null; signal?: number }
  | { type: "ready"; pid: number }
  | { type: "title"; name: string }
  | { type: "pong" };
