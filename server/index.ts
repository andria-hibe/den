import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import os from "node:os";
import { spawnSession } from "./pty.ts";
import type { ClientMessage } from "./ws-protocol.ts";

const PORT = Number(process.env.PORT ?? 4321);
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = Fastify({ logger: false });
await app.register(websocket);

// Health / sanity endpoint.
app.get("/api/health", async () => ({ ok: true, home: os.homedir() }));

/**
 * Terminal WebSocket. Query params:
 *   name  — session display name (passed to `claude -n`)
 *   cwd   — working directory for the session
 *   shell — "1" to spawn a plain shell instead of claude (debug)
 */
app.get("/ws/terminal", { websocket: true }, (socket, req) => {
  const url = new URL(req.url, "http://localhost");
  const name = url.searchParams.get("name") ?? "session";
  const cwd = url.searchParams.get("cwd") ?? os.homedir();
  const shell = url.searchParams.get("shell") === "1";

  const session = spawnSession({ name, cwd, shell }, (msg) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  });

  socket.on("message", (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    session.handle(msg);
  });

  socket.on("close", () => session.dispose());
});

// Serve the built web app in production (dev uses the Vite server + proxy).
const webDist = join(__dirname, "..", "web");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
}

app
  .listen({ port: PORT, host: "127.0.0.1" })
  .then(() => console.log(`🦊 den server on http://localhost:${PORT}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
