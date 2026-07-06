import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import os from "node:os";
import type { AddressInfo } from "node:net";
import { sessions } from "./sessions.ts";
import { getMyPullRequests, type PrBuckets } from "./github.ts";
import {
  getAssignedIssues,
  validateKey,
  setKey,
  clearKey,
  hasKey,
  type LinearData,
} from "./linear.ts";
import { roots, listDirs, makeDir, isDir } from "./fs.ts";
import { listPastSessions } from "./discover.ts";
import type { ClientMessage, ServerMessage } from "./ws-protocol.ts";

export interface StartOptions {
  /** Port to bind. 0 = ephemeral (recommended for the desktop app). */
  port?: number;
  host?: string;
  /** Directory of the built web app to serve (for the packaged app). */
  webDir?: string;
}

export interface RunningServer {
  port: number;
  url: string;
  close: () => Promise<void>;
}

export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const host = opts.host ?? "127.0.0.1";
  const webDir = opts.webDir ?? process.env.DEN_WEB_DIR;

  sessions.hydrate();

  const app = Fastify({ logger: false });
  await app.register(websocket);

  app.get("/api/health", async () => ({ ok: true, home: os.homedir() }));

  // --- Filesystem browsing (New Session dialog) ---
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

  // --- Sessions REST ---
  app.get("/api/sessions", async () => ({ sessions: sessions.list() }));

  // Past Claude sessions on disk, for resuming.
  app.get("/api/sessions/past", async () => ({ sessions: listPastSessions() }));

  app.post("/api/sessions", async (req, reply) => {
    const body = (req.body ?? {}) as {
      name?: string;
      color?: string;
      cwd?: string;
      shell?: boolean;
      resumeId?: string;
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

  // --- Workspace progress notepad ---
  app.get("/api/notepad/:groupId", async (req) => {
    const { groupId } = req.params as { groupId: string };
    return { content: sessions.readNotepad(groupId) };
  });

  app.put("/api/notepad/:groupId", async (req) => {
    const { groupId } = req.params as { groupId: string };
    const { content } = (req.body ?? {}) as { content?: string };
    sessions.writeNotepad(groupId, content ?? "");
    return { ok: true };
  });

  // --- GitHub PRs (cached) ---
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

  // --- Linear (cached) ---
  app.get("/api/linear/status", async () => ({ connected: hasKey() }));

  app.post("/api/linear/key", async (req, reply) => {
    const { key } = (req.body ?? {}) as { key?: string };
    if (!key || !key.trim()) {
      reply.code(400);
      return { error: "key_required" };
    }
    try {
      const viewer = await validateKey(key.trim());
      setKey(key.trim());
      linearCache = null;
      return { connected: true, viewer };
    } catch (err) {
      reply.code(401);
      return { error: (err as Error).message };
    }
  });

  app.delete("/api/linear/key", async () => {
    clearKey();
    linearCache = null;
    return { connected: false };
  });

  const LINEAR_TTL_MS = 30_000;
  let linearCache: { at: number; data: LinearData } | null = null;
  app.get("/api/linear/issues", async (req, reply) => {
    if (!hasKey()) {
      reply.code(409);
      return { error: "not_connected" };
    }
    const fresh = (req.query as { refresh?: string })?.refresh === "1";
    if (!fresh && linearCache && Date.now() - linearCache.at < LINEAR_TTL_MS) {
      return linearCache.data;
    }
    try {
      const data = await getAssignedIssues();
      linearCache = { at: Date.now(), data };
      return data;
    } catch (err) {
      const msg = (err as Error).message;
      reply.code(msg === "unauthorized" ? 401 : 502);
      return { error: msg };
    }
  });

  // --- Terminal WebSocket: attach to an existing session by id ---
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

  // Serve the built web app (packaged desktop app; dev uses Vite + proxy).
  if (webDir && existsSync(webDir)) {
    await app.register(fastifyStatic, { root: webDir });
  }

  await app.listen({ port: opts.port ?? 4321, host });
  const port = (app.server.address() as AddressInfo).port;
  return {
    port,
    url: `http://${host}:${port}`,
    close: () => app.close(),
  };
}
