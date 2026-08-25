import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { sessions, isValidGroupId } from "./sessions.ts";
import {
  getMyPullRequests,
  getPrDetail,
  getPrDiff,
  reviewPr,
  isValidRepo,
  type PrBuckets,
} from "./github.ts";
import {
  getAssignedIssues,
  getIssueComments,
  validateKey,
  setKey,
  clearKey,
  hasKey,
  type LinearData,
} from "./linear.ts";
import { roots, listDirs, makeDir, isDir } from "./fs.ts";
import { listPastSessions } from "./discover.ts";
import { prepareWork, checkoutPr, type WorkEnv } from "./git.ts";
import { detectAppRunner, appRunnerStatus } from "./apprun.ts";
import { isLocalRequest } from "./security.ts";
import { logWarn } from "./log.ts";
import type { ClientMessage, ServerMessage } from "./ws-protocol.ts";

/** A positive-integer PR number, coerced from untrusted query/body input. */
export function prNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Strip control bytes from text pasted into a PTY. Pasted content is
 * attacker-controllable (PR/ticket comments reach it via "→ Claude"), so it must
 * not carry terminal escape sequences — in particular an embedded `\x1b[201~`
 * that would end bracketed paste early and inject live input, or OSC sequences
 * that spoof the title / touch the clipboard. Tab and newline are kept.
 */
export function sanitizePaste(text: string): string {
  // Drop ESC (0x1B), CR (0x0D), and the other C0 controls + DEL, leaving only
  // \t (09) and \n (0A). Stripping CR too means a raw carriage return can't
  // submit input in a pane that isn't honouring bracketed paste (e.g. a shell).
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

// Beat between a bracketed paste and the carriage return that submits it (for
// `POST /api/sessions/:id/paste` with `submit`), so Claude's TUI has taken the
// text into its input box before Enter arrives.
const PASTE_SUBMIT_DELAY_MS = 250;

// Single-quote a path for a POSIX shell (wraps the ' → '\'' escape). Used to
// build the `cd <dir> && …` command written into a spin-up shell tab.
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

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

  // Reject cross-origin / rebound requests before any handler runs. This covers
  // both REST routes and the terminal WebSocket upgrade (a GET that hits this
  // hook first), so a page you're browsing can't reach the local control plane.
  app.addHook("onRequest", async (req, reply) => {
    if (!isLocalRequest(req.headers)) {
      reply.code(403).send({ error: "forbidden" });
    }
  });

  app.get("/api/health", async () => ({ ok: true }));

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
      ticket?: string;
      look?: boolean;
      branch?: string;
      env?: WorkEnv;
      notepadSeed?: string;
      view?: "review" | "mypr";
      pr?: number;
      prRepo?: string;
      initialPrompt?: string;
      reviewDiff?: string;
    };
    // Reuse an existing running session for the same ticket (same look/work
    // mode) so we never create duplicate sessions or branches for one issue.
    if (body.ticket) {
      const existing = sessions
        .list()
        .find(
          (m) =>
            m.role === "main" &&
            m.status === "running" &&
            m.ticket === body.ticket &&
            !!m.look === !!body.look,
        );
      if (existing) return existing;
    }
    // Reuse an existing session for the same PR too.
    if (body.pr && body.prRepo) {
      const existing = sessions
        .list()
        .find(
          (m) =>
            m.role === "main" &&
            m.status === "running" &&
            m.pr === body.pr &&
            m.prRepo === body.prRepo,
        );
      if (existing) return existing;
    }
    // "Work on it": set up the branch/worktree first, then open there.
    if (body.branch && body.env) {
      try {
        const { cwd } = prepareWork(roots().workRepo, body.branch, body.env);
        body.cwd = cwd;
      } catch (err) {
        logWarn("prepareWork", err);
        reply.code(500);
        return { error: "git_failed", message: "Could not prepare the branch." };
      }
    }
    // PR review / edit: check out the PR so Claude has the code.
    if (body.pr && body.prRepo && body.env) {
      const pr = prNumber(body.pr);
      if (pr === null || !isValidRepo(body.prRepo)) {
        reply.code(400);
        return { error: "bad_pr" };
      }
      try {
        const { cwd } = checkoutPr(
          roots().workRepo, body.prRepo, pr, body.env, body.branch,
        );
        body.cwd = cwd;
      } catch (err) {
        logWarn("checkoutPr", err);
        reply.code(500);
        return { error: "git_failed", message: "Could not check out the PR." };
      }
      // Hand the review session the diff as a file so the whole change is in
      // front of it immediately, without a `gh pr diff` round-trip of its own.
      if (body.view === "review") {
        try {
          body.reviewDiff = (await getPrDiff(body.prRepo, pr)).slice(0, 200_000);
        } catch (err) {
          logWarn("github.diff(review)", err);
        }
      }
    }
    if (body.cwd && !isDir(body.cwd)) {
      reply.code(400);
      return { error: "bad_cwd" };
    }
    const meta = sessions.create(body);
    reply.code(201);
    return meta;
  });

  // Add another shell pane (tab) to the workspace the given session belongs to.
  app.post("/api/sessions/:id/shell", async (req, reply) => {
    const { id } = req.params as { id: string };
    const session = sessions.get(id);
    if (!session) {
      reply.code(404);
      return { error: "not_found" };
    }
    const meta = sessions.addShell(session.groupId);
    if (!meta) {
      reply.code(404);
      return { error: "not_found" };
    }
    reply.code(201);
    return meta;
  });

  // Re-spawn an exited session's PTY (e.g. after den was closed/reopened).
  app.post("/api/sessions/:id/restart", async (req, reply) => {
    const { id } = req.params as { id: string };
    const meta = sessions.restart(id);
    if (!meta) {
      reply.code(409);
      return { error: "cannot_restart" };
    }
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

  // Paste text into a session's Claude prompt. Bracketed paste keeps multi-line
  // input as one entry; by default it does NOT auto-submit (the "→ Claude"
  // comment buttons want you to read it first).
  //
  // `submit: true` follows the paste with a carriage return, for the actions that
  // mean "do this now" (den's own pre-review prompt). The CR is generated here,
  // never carried by `text` — `sanitizePaste` still strips CR from the content, so
  // an attacker-supplied PR comment can't submit itself by embedding one. It goes
  // in a separate write after a short beat: Claude's TUI ingests the paste
  // asynchronously, and a CR in the same chunk can land before the input box has
  // taken the text.
  //
  // A submit also waits for the pane to be ready first (`waitUntilIdle`): a
  // freshly spawned Claude drops input while it's still drawing, and "send this
  // now" that silently vanishes is worse than one that takes a moment.
  app.post("/api/sessions/:id/paste", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { text, submit } = (req.body ?? {}) as {
      text?: string;
      submit?: boolean;
    };
    const session = sessions.get(id);
    if (!session) {
      reply.code(404);
      return { error: "not_found" };
    }
    if (!text) {
      reply.code(400);
      return { error: "text_required" };
    }
    let ready: boolean | undefined;
    if (submit) ready = await session.waitUntilIdle();
    session.write(`\x1b[200~${sanitizePaste(text)}\x1b[201~`);
    if (submit) {
      await new Promise((r) => setTimeout(r, PASTE_SUBMIT_DELAY_MS));
      session.write("\r");
    }
    return { ok: true, submitted: !!submit, ready };
  });

  // Can the app this workspace is working on be run locally? Returns how to run
  // it, whether it's already up, and a URL to open (see server/apprun.ts).
  app.get("/api/app/runner", async (req, reply) => {
    const { sessionId } = req.query as { sessionId?: string };
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) {
      reply.code(404);
      return { error: "not_found" };
    }
    try {
      return await appRunnerStatus(session.cwd);
    } catch (e) {
      logWarn("app runner status failed", e);
      reply.code(500);
      return { error: "status_failed" };
    }
  });

  // Spin up the workspace's app in a fresh shell tab: adds a shell to the group,
  // then types `cd <repo> && <command>` into it. Returns the new shell's meta so
  // the client can switch to that tab.
  app.post("/api/app/run", async (req, reply) => {
    const { sessionId } = (req.body ?? {}) as { sessionId?: string };
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) {
      reply.code(404);
      return { error: "not_found" };
    }
    const runner = detectAppRunner(session.cwd);
    if (!runner.command) {
      reply.code(400);
      return { error: "not_runnable" };
    }
    const meta = sessions.addShell(session.groupId);
    if (!meta) {
      reply.code(404);
      return { error: "not_found" };
    }
    // Type the command once the fresh login shell has settled (early keystrokes
    // can be eaten by zsh prompt init).
    const shell = sessions.get(meta.id);
    const cmd = `cd ${shellQuote(runner.dir)} && ${runner.command}\r`;
    setTimeout(() => shell?.write(cmd), 400);
    reply.code(201);
    return meta;
  });

  app.delete("/api/sessions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    // ?scope=one closes just this pane (a shell tab); default closes the whole
    // workspace the session belongs to.
    const scope = (req.query as { scope?: string })?.scope;
    const ok =
      scope === "one" ? sessions.removeOne(id) : sessions.remove(id);
    if (!ok) {
      reply.code(404);
      return { error: "not_found" };
    }
    return { ok: true };
  });

  // --- Workspace progress notepad ---
  app.get("/api/notepad/:groupId", async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    if (!isValidGroupId(groupId)) {
      reply.code(400);
      return { error: "bad_group_id" };
    }
    return { content: sessions.readNotepad(groupId) };
  });

  app.put("/api/notepad/:groupId", async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    if (!isValidGroupId(groupId)) {
      reply.code(400);
      return { error: "bad_group_id" };
    }
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
      logWarn("github", err);
      reply.code(502);
      return { error: "gh_failed", message: "GitHub request failed." };
    }
  });

  // Single-PR detail (description + colleagues' reviews/comments).
  app.get("/api/github/pr", async (req, reply) => {
    const { repo, number } = req.query as { repo?: string; number?: string };
    const n = prNumber(number);
    if (!repo || !isValidRepo(repo) || n === null) {
      reply.code(400);
      return { error: "repo_and_number_required" };
    }
    try {
      return await getPrDetail(repo, n);
    } catch (err) {
      logWarn("github", err);
      reply.code(502);
      return { error: "gh_failed", message: "GitHub request failed." };
    }
  });

  // Raw unified diff for a PR.
  app.get("/api/github/pr/diff", async (req, reply) => {
    const { repo, number } = req.query as { repo?: string; number?: string };
    const n = prNumber(number);
    if (!repo || !isValidRepo(repo) || n === null) {
      reply.code(400);
      return { error: "repo_and_number_required" };
    }
    try {
      return { diff: await getPrDiff(repo, n) };
    } catch (err) {
      logWarn("github", err);
      reply.code(502);
      return { error: "gh_failed", message: "GitHub request failed." };
    }
  });

  // Claude's written review of a PR (headless; may take a while).
  app.post("/api/github/pr/review", async (req, reply) => {
    const { repo, number } = (req.body ?? {}) as {
      repo?: string;
      number?: number;
    };
    const n = prNumber(number);
    if (!repo || !isValidRepo(repo) || n === null) {
      reply.code(400);
      return { error: "repo_and_number_required" };
    }
    try {
      return { review: await reviewPr(repo, n) };
    } catch (err) {
      logWarn("github.review", err);
      reply.code(502);
      return { error: "review_failed", message: "Claude review failed." };
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

  app.get("/api/linear/comments", async (req, reply) => {
    if (!hasKey()) {
      reply.code(409);
      return { error: "not_connected" };
    }
    const id = (req.query as { id?: string })?.id;
    if (!id) {
      reply.code(400);
      return { error: "id_required" };
    }
    try {
      return { comments: await getIssueComments(id) };
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
