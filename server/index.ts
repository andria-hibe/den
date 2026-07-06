import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import os from "node:os";
import { sessions } from "./sessions.ts";
import { getMyPullRequests, type PrBuckets } from "./github.ts";
import { roots, listDirs, makeDir, isDir } from "./fs.ts";
import type { ClientMessage, ServerMessage } from "./ws-protocol.ts";

const PORT = Number(process.env.PORT ?? 4321);
const __dirname = dirname(fileURLToPath(import.meta.url));

sessions.hydrate();

const app = Fastify({ logger: false });
await app.register(websocket);

// Health / sanity endpoint.
app.get("/api/health", async () => ({ ok: true, home: os.homedir() }));

// --- Filesystem browsing (for the New Session dialog) -----------------------

app.get("/api/fs/roots", async () => roots());

app.get("/api/fs/dirs", async (req, reply) => {
  const path = (req.query as { path?: string })?.path ?? roots().documents;
  try {
    return listDirs(path);
  } catch (err) {
    reply.code(400);
    return { error: (err as Error).message };
  }
});

app.post("/api/fs/dirs", async (req, reply) => {
  const { parent, name } = (req.body ?? {}) as { parent?: string; name?: string };
  if (!parent || !name) {
    reply.code(400);
    return { error: "parent_and_name_required" };
  }
  try {
    return { path: makeDir(parent, name) };
  } catch (err) {
    reply.code(400);
    return { error: (err as Error).message };
  }
});

// --- Sessions REST ----------------------------------------------------------

app.get("/api/sessions", async () => ({ sessions: sessions.list() }));

app.post("/api/sessions", async (req, reply) => {
  const body = (req.body ?? {}) as {
    name?: string;
    color?: string;
    cwd?: string;
    shell?: boolean;
  };
  if (body.cwd && !isDir(body.cwd)) {
    reply.code(400);
    return { error: "bad_cwd" };
  }
  const meta = sessions.create(body);
  reply.code(201);
  return meta;
});

app.patch("/api/sessions/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as { name?: string; color?: string };
  const meta = sessions.update(id, body);
  if (!meta) {
    reply.code(404);
    return { error: "not_found" };
  }
  return meta;
});

app.delete("/api/sessions/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const ok = sessions.remove(id);
  if (!ok) {
    reply.code(404);
    return { error: "not_found" };
  }
  return { ok: true };
});

// --- GitHub PRs (cached) -----------------------------------------------------

const PR_TTL_MS = 30_000;
let prCache: { at: number; data: PrBuckets } | null = null;
app.get("/api/github/prs", async (req, reply) => {
  const fresh = (req.query as { refresh?: string })?.refresh === "1";
  if (!fresh && prCache && Date.now() - prCache.at < PR_TTL_MS) {
    return prCache.data;
  }
  try {
    const data = await getMyPullRequests();
    prCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    reply.code(502);
    return { error: "gh_failed", message: (err as Error).message };
  }
});

// --- Terminal WebSocket: attach to an existing session by id ----------------

app.get("/ws/terminal", { websocket: true }, (socket, req) => {
  const url = new URL(req.url, "http://localhost");
  const id = url.searchParams.get("id");
  const session = id ? sessions.get(id) : undefined;

  const send = (msg: ServerMessage) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  if (!session) {
    send({ type: "exit", code: null });
    socket.close();
    return;
  }

  // Attach atomically: capture scrollback + register listener in one tick.
  const { scrollback, detach } = session.attach(send);
  send({ type: "ready", pid: session.meta().pid ?? 0 });
  if (scrollback) send({ type: "output", data: scrollback });
  if (session.status === "exited") send({ type: "exit", code: null });

  socket.on("message", (raw: Buffer) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "input") session.write(msg.data);
    else if (msg.type === "resize") session.resize(msg.cols, msg.rows);
  });

  socket.on("close", () => detach());
});

// Serve the built web app in production (dev uses the Vite server + proxy).
const webDist = join(__dirname, "..", "dist", "web");
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
