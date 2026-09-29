import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { sessions, isValidGroupId } from "./sessions.ts";
import { cleanupSkill } from "./cleanup.ts";
import {
  getMyPullRequests,
  getPrDetail,
  getPrDiff,
  isValidRepo,
  isValidNodeId,
  submitReview,
  replyToThread,
  resolveThread,
  type ReviewComment,
  type ReviewEvent,
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
import { roots, listDirs, makeDir, isDir, baseBranchOverride } from "./fs.ts";
import { listPastSessions } from "./discover.ts";
import {
  prepareWork, checkoutPr, listWorktrees, isDenWorktree, worktreeChanges, removeWorktree,
  repoBaseName, isValidBranch,
  type WorkEnv,
} from "./git.ts";
import { detectAppRunner, appRunnerStatus, detectSetup, setupScript } from "./apprun.ts";
import { isLocalRequest } from "./security.ts";
import { logWarn } from "./log.ts";
import type { ClientMessage, ServerMessage } from "./ws-protocol.ts";

/** A positive-integer PR number, coerced from untrusted query/body input. */
const execFileP = promisify(execFile);

export function prNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Strip control bytes from text pasted into a PTY. Pasted content is
 * attacker-controllable (PR/ticket comments reach it via "→ Claude"), so it must
 * not carry terminal escape sequences: an embedded `\x1b[201~` would end
 * bracketed paste early and inject live input, and OSC sequences can spoof the
 * title or touch the clipboard.
 */
export function sanitizePaste(text: string): string {
  // Of the control bytes, keeps only \t and \n. Dropping CR means a raw CR
  // can't submit input in a pane that ignores bracketed paste (e.g. a shell).
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

// Beat between a bracketed paste and the carriage return that submits it, so
// Claude's TUI has taken the text into its input box before Enter arrives.
const PASTE_SUBMIT_DELAY_MS = 250;

// Single-quote a path for a POSIX shell.
export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Wrap an async fetcher in a TTL cache. `get(true)` bypasses the cache;
 * errors are not cached, so the next get retries. */
function ttlCache<T>(ttlMs: number, fn: () => Promise<T>) {
  let hit: { at: number; data: T } | null = null;
  return {
    async get(fresh = false): Promise<T> {
      if (!fresh && hit && Date.now() - hit.at < ttlMs) return hit.data;
      const data = await fn();
      hit = { at: Date.now(), data };
      return data;
    },
    invalidate() {
      hit = null;
    },
  };
}

export interface StartOptions {
  /** Port to bind; 0 = ephemeral. */
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

  // Before any handler, so it covers the terminal WebSocket upgrade too (a GET
  // that hits this hook first): a page you're browsing can't reach den.
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

  // A worktree a session is working in is never offered for removal.
  const sessionsIn = (path: string) =>
    sessions.list().filter((m) => m.cwd === path || m.cwd.startsWith(path + "/"));

  // Every checkout of the work repo, the New Session dialog's "workspaces".
  // The repo is resolved server-side, so nothing here takes a caller path.
  app.get("/api/git/worktrees", async (req, reply) => {
    const repo = roots().workRepo;
    try {
      // For the New Session dialog's cleanup.
      const worktrees = listWorktrees(repo).map((w) => {
        if (!isDenWorktree(repo, w.path)) return { ...w, den: false };
        let changes = null;
        try {
          changes = worktreeChanges(w.path);
        } catch {
          // missing on disk (prunable): nothing to lose
        }
        return { ...w, den: true, changes, inUse: sessionsIn(w.path).length > 0 };
      });
      return { repo, base: repoBaseName(repo, baseBranchOverride()), worktrees };
    } catch (err) {
      // Not a git repo (workDir() falls back to ~/Documents/work): the dialog
      // drops to plain folder browsing.
      logWarn("git.worktrees", err);
      reply.code(400);
      return { error: "not_a_repo" };
    }
  });

  // For the cleanup offer when a session closes. `den: false` (or a 404)
  // means there is nothing to offer.
  app.get("/api/git/worktree", async (req, reply) => {
    const { path } = req.query as { path?: string };
    const repo = roots().workRepo;
    if (!path || !isDenWorktree(repo, path)) return { den: false };
    const w = (() => {
      try {
        return listWorktrees(repo).find((t) => t.path === path);
      } catch {
        return undefined;
      }
    })();
    if (!w) {
      reply.code(404);
      return { error: "not_a_worktree" };
    }
    try {
      return { ...w, den: true, changes: worktreeChanges(path), inUse: sessionsIn(path).length > 0 };
    } catch (err) {
      logWarn("git.worktree", err);
      reply.code(500);
      return { error: "git_failed" };
    }
  });

  // The branch stays. `force` is required when uncommitted work would be lost,
  // and the client sends it only after the developer saw that.
  app.post("/api/git/worktrees/remove", async (req, reply) => {
    const { path, force } = (req.body ?? {}) as { path?: string; force?: boolean };
    const repo = roots().workRepo;
    if (!path || !isDenWorktree(repo, path)) {
      reply.code(400);
      return { error: "not_den_worktree" };
    }
    if (sessionsIn(path).length > 0) {
      reply.code(409);
      return { error: "in_use", message: "A session is still open in that worktree." };
    }
    try {
      removeWorktree(repo, path, !!force);
      return { ok: true };
    } catch (err) {
      const code = (err as Error).message;
      if (code === "would_lose_work") {
        reply.code(409);
        return { error: code, message: "That worktree has uncommitted work." };
      }
      logWarn("git.removeWorktree", err);
      reply.code(500);
      return { error: "git_failed", message: "Could not remove the worktree." };
    }
  });

  // --- Sessions REST ---
  app.get("/api/sessions", async () => ({ sessions: sessions.list() }));

  // Past Claude sessions on disk, for resuming.
  app.get("/api/sessions/past", async () => ({ sessions: listPastSessions() }));

  // The workspace (groupId) order, top to bottom.
  app.post("/api/sessions/reorder", async (req, reply) => {
    const body = (req.body ?? {}) as { groupIds?: unknown };
    if (
      !Array.isArray(body.groupIds) ||
      body.groupIds.some((g) => typeof g !== "string")
    ) {
      reply.code(400);
      return { error: "bad_order" };
    }
    return { sessions: sessions.reorder(body.groupIds as string[]) };
  });

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
      /** Start a new work branch from this local branch instead of the repo base. */
      base?: string;
    };
    // Reuse a running session for the same ticket and mode, so one issue never
    // gets duplicate sessions or branches.
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
    if (body.branch && body.env) {
      try {
        if (body.base && !isValidBranch(body.base)) {
          reply.code(400);
          return { error: "bad_base" };
        }
        const { cwd } = prepareWork(
          roots().workRepo, body.branch, body.env, baseBranchOverride(), body.base,
        );
        body.cwd = cwd;
      } catch (err) {
        if ((err as Error).message === "no_such_base") {
          reply.code(400);
          return { error: "no_such_base", message: "That base branch doesn't exist any more." };
        }
        logWarn("prepareWork", err);
        reply.code(500);
        return { error: "git_failed", message: "Could not prepare the branch." };
      }
    }
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
      // So the whole change is in front of the session without a `gh pr diff`
      // round-trip of its own.
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

  // --- Posting to GitHub (#16) ---
  // Each writes to GitHub as the developer, reached by one explicit click on
  // content they've just seen. Inputs are checked here as well as in the UI.
  const MAX_POST = 65_000; // GitHub's comment body limit is 65,536
  const postError = (reply: { code: (n: number) => void }, where: string, err: unknown) => {
    logWarn(where, err);
    reply.code(502);
    // gh prints GitHub's message on stderr ("Pull request review thread line
    // must be part of the diff", "Can not approve your own pull request"),
    // which is what the developer needs to fix it. Nothing secret in it.
    const stderr = String((err as { stderr?: string }).stderr ?? "").trim().split("\n").pop() ?? "";
    return { error: "github_failed", message: stderr || "GitHub refused the request." };
  };

  app.post("/api/github/pr/review-submit", async (req, reply) => {
    const b = (req.body ?? {}) as {
      repo?: string; number?: unknown; event?: string; body?: string; comments?: ReviewComment[];
    };
    const n = prNumber(b.number);
    const events: ReviewEvent[] = ["COMMENT", "APPROVE", "REQUEST_CHANGES"];
    const comments = Array.isArray(b.comments) ? b.comments : [];
    const okComment = (c: ReviewComment) =>
      typeof c?.path === "string" && c.path.length > 0 && c.path.length < 1000 && !c.path.startsWith("-") &&
      Number.isInteger(c.line) && c.line > 0 &&
      typeof c.body === "string" && c.body.trim() !== "" && c.body.length <= MAX_POST;
    if (
      !b.repo || !isValidRepo(b.repo) || n === null ||
      !events.includes(b.event as ReviewEvent) ||
      typeof b.body !== "string" || b.body.length > MAX_POST ||
      comments.length > 100 || !comments.every(okComment) ||
      (b.body.trim() === "" && comments.length === 0)
    ) {
      reply.code(400);
      return { error: "bad_review" };
    }
    try {
      const url = await submitReview(b.repo, n, b.event as ReviewEvent, b.body, comments);
      return { ok: true, url };
    } catch (err) {
      return postError(reply, "github.submitReview", err);
    }
  });

  app.post("/api/github/pr/reply", async (req, reply) => {
    const b = (req.body ?? {}) as { repo?: string; number?: unknown; commentId?: unknown; body?: string };
    const n = prNumber(b.number);
    const id = prNumber(b.commentId);
    if (!b.repo || !isValidRepo(b.repo) || n === null || id === null ||
        typeof b.body !== "string" || !b.body.trim() || b.body.length > MAX_POST) {
      reply.code(400);
      return { error: "bad_reply" };
    }
    try {
      await replyToThread(b.repo, n, id, b.body);
      return { ok: true };
    } catch (err) {
      return postError(reply, "github.reply", err);
    }
  });

  app.post("/api/github/pr/resolve", async (req, reply) => {
    const { threadId } = (req.body ?? {}) as { threadId?: string };
    if (!threadId || !isValidNodeId(threadId)) {
      reply.code(400);
      return { error: "bad_thread" };
    }
    try {
      await resolveThread(threadId);
      return { ok: true };
    } catch (err) {
      return postError(reply, "github.resolve", err);
    }
  });

  // The rail's clean-up button (#29): the skill it names, and where it opens.
  app.get("/api/cleanup", async () => ({ skill: cleanupSkill(), cwd: roots().workRepo }));

  // What a Claude pane has spent (#11).
  app.get("/api/sessions/:id/usage", async (req, reply) => {
    const { id } = req.params as { id: string };
    const u = sessions.usage(id);
    if (!u) {
      reply.code(404);
      return { error: "not_found" };
    }
    return u;
  });

  app.post("/api/sessions/:id/handover", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { on } = (req.body ?? {}) as { on?: boolean };
    const meta = sessions.setHandover(id, on !== false);
    if (!meta) {
      reply.code(400);
      return { error: "not_a_workspace" };
    }
    return meta;
  });

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

  // Bracketed paste keeps multi-line input as one entry. By default it does
  // not submit: the "→ Claude" buttons want you to read it first.
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
  // freshly spawned Claude drops input while it's still drawing.
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

  // Which shell tab den launched each workspace's app in (#28), by group.
  const appTabs = new Map<string, string>();
  const liveAppTab = (groupId: string) => {
    const id = appTabs.get(groupId);
    const tab = id ? sessions.get(id) : undefined;
    return tab && tab.status === "running" && tab.groupId === groupId ? tab : null;
  };

  app.get("/api/app/runner", async (req, reply) => {
    const { sessionId } = req.query as { sessionId?: string };
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) {
      reply.code(404);
      return { error: "not_found" };
    }
    try {
      const status = await appRunnerStatus(session.cwd);
      // A script app can be stopped only through den's tab.
      return { ...status, appTab: !!liveAppTab(session.groupId) };
    } catch (e) {
      logWarn("app runner status failed", e);
      reply.code(500);
      return { error: "status_failed" };
    }
  });

  // Typed into a new shell tab rather than run here, so the output is in front
  // of you and Ctrl-C works. Returns the tab's meta so the client can switch.
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
    // A fresh login shell eats keystrokes typed during zsh's prompt init.
    const shell = sessions.get(meta.id);
    const cmd = `cd ${shellQuote(runner.dir)} && ${runner.command}\r`;
    setTimeout(() => shell?.write(cmd), 400);
    // So stop can Ctrl-C a script app there (#28).
    appTabs.set(session.groupId, meta.id);
    reply.code(201);
    return meta;
  });

  // Stop the workspace's app (#28). A stack with a teardown command gets it
  // typed into a new shell tab, like run; a script app gets Ctrl-C in the tab
  // den ran it in. Returns the new tab's meta, or { interrupted: true }.
  app.post("/api/app/stop", async (req, reply) => {
    const { sessionId } = (req.body ?? {}) as { sessionId?: string };
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) {
      reply.code(404);
      return { error: "not_found" };
    }
    const runner = detectAppRunner(session.cwd);
    if (runner.stopCommand) {
      const meta = sessions.addShell(session.groupId);
      if (!meta) {
        reply.code(404);
        return { error: "not_found" };
      }
      const shell = sessions.get(meta.id);
      const cmd = `cd ${shellQuote(runner.dir)} && ${runner.stopCommand}\r`;
      setTimeout(() => shell?.write(cmd), 400);
      reply.code(201);
      return meta;
    }
    const tab = liveAppTab(session.groupId);
    if (tab) {
      tab.write("\x03");
      return { interrupted: true };
    }
    reply.code(400);
    return { error: "not_running", message: "den didn't start this app, so it can't stop it." };
  });

  // Tear down the stack of a checkout whose workspace just closed (#28), so a
  // removed worktree can't leave its containers running. Only a checkout of
  // the work repo, only with a teardown command, and run to completion here
  // (the workspace's tabs are gone).
  app.post("/api/app/stop-dir", async (req, reply) => {
    const { path } = (req.body ?? {}) as { path?: string };
    const repo = roots().workRepo;
    let known: boolean;
    try {
      known = !!path && listWorktrees(repo).some((w) => w.path === path);
    } catch {
      known = false; // the work dir isn't a git repo
    }
    const runner = known && path ? detectAppRunner(path) : null;
    if (!runner?.stopCommand) {
      reply.code(400);
      return { error: "no_stop" };
    }
    try {
      const { stdout, stderr } = await execFileP("/bin/sh", ["-c", runner.stopCommand], {
        cwd: runner.dir,
        timeout: 5 * 60_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const tail = `${stdout}${stderr}`.trim().split("\n").slice(-3).join("\n");
      return { ok: true, output: tail };
    } catch (err) {
      logWarn("app.stopDir", err);
      reply.code(502);
      return { error: "stop_failed", message: "The teardown command failed; run it in a terminal to see why." };
    }
  });

  // Worktree setup (#10): the repo's own setup command, and whether this
  // worktree looks like it still needs it.
  app.get("/api/app/setup", async (req, reply) => {
    const { sessionId } = req.query as { sessionId?: string };
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) {
      reply.code(404);
      return { error: "not_found" };
    }
    return detectSetup(session.cwd);
  });

  // Typed into a new shell tab, like the run button.
  app.post("/api/app/setup", async (req, reply) => {
    const { sessionId } = (req.body ?? {}) as { sessionId?: string };
    const session = sessionId ? sessions.get(sessionId) : null;
    if (!session) {
      reply.code(404);
      return { error: "not_found" };
    }
    const setup = detectSetup(session.cwd);
    const script = setupScript(setup);
    if (!script || setup.main) {
      reply.code(400);
      return { error: "no_setup" };
    }
    const meta = sessions.addShell(session.groupId);
    if (!meta) {
      reply.code(404);
      return { error: "not_found" };
    }
    const shell = sessions.get(meta.id);
    const cmd = `cd ${shellQuote(setup.dir)} && ${script}\r`;
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

  // Read-only from the client: only the review session writes the guide.
  app.get("/api/review/guide/:groupId", async (req, reply) => {
    const { groupId } = req.params as { groupId: string };
    if (!isValidGroupId(groupId)) {
      reply.code(400);
      return { error: "bad_group_id" };
    }
    return { content: sessions.readReviewGuide(groupId) };
  });

  // --- GitHub PRs (cached) ---
  const prCache = ttlCache<PrBuckets>(30_000, getMyPullRequests);
  app.get("/api/github/prs", async (req, reply) => {
    const fresh = (req.query as { refresh?: string })?.refresh === "1";
    try {
      return await prCache.get(fresh);
    } catch (err) {
      logWarn("github", err);
      reply.code(502);
      return { error: "gh_failed", message: "GitHub request failed." };
    }
  });

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

  // --- Linear (cached) ---
  const linearCache = ttlCache<LinearData>(30_000, getAssignedIssues);
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
      linearCache.invalidate();
      return { connected: true, viewer };
    } catch (err) {
      reply.code(401);
      return { error: (err as Error).message };
    }
  });

  app.delete("/api/linear/key", async () => {
    clearKey();
    linearCache.invalidate();
    return { connected: false };
  });

  app.get("/api/linear/issues", async (req, reply) => {
    if (!hasKey()) {
      reply.code(409);
      return { error: "not_connected" };
    }
    const fresh = (req.query as { refresh?: string })?.refresh === "1";
    try {
      return await linearCache.get(fresh);
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
