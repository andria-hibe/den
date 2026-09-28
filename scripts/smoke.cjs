// End-to-end smoke test (#21): boots a den server on a throwaway database,
// loads the real UI in a headless Electron window, opens a shell session from
// the rail, and checks that the rail lists it, its terminal attaches, and a
// typed command's output comes back. Exits 0 on success, 1 with the failed
// step otherwise.
//
//   npm run smoke          (builds the web UI first)
//
// The server runs under tsx on node_modules' Node build, which stays in place
// even after `npm run app` (see scripts/native-electron.mjs). Typing uses sendInputEvent: synthetic
// DOM keyboard events are untrusted and xterm ignores them.
const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const TIMEOUT_MS = 20_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
let tmp = null;
const steps = [];

function done(code, message) {
  if (message) console.log(message);
  try {
    // The whole group: npx, tsx, the server, and any shell it spawned.
    if (server?.pid) process.kill(-server.pid, "SIGTERM");
  } catch {
    // already gone
  }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  app.exit(code);
}

/** Retry `check` until it returns something truthy, or fail the step. */
async function waitFor(step, check) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const v = await check().catch(() => null);
    if (v) {
      steps.push(`ok   ${step}`);
      return v;
    }
    await sleep(250);
  }
  throw new Error(`timed out: ${step}`);
}

function startServer() {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "den-smoke-"));
  // A clean environment for the server: its own db, no idle handovers, and
  // none of a surrounding Claude session's variables (panes would inherit them).
  const env = { ...process.env, PORT: "0", DEN_DB: path.join(tmp, "den.db"), DEN_IDLE_HANDOVER_MIN: "0" };
  for (const k of Object.keys(env)) if (k.startsWith("CLAUDE")) delete env[k];
  server = spawn("npx", ["tsx", "server/index.ts"], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true, // its own process group, so done() can stop all of it
  });
  let log = "";
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server didn't start:\n${log}`)), TIMEOUT_MS);
    const onData = (d) => {
      log += d;
      const m = log.match(/den server on (http:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    };
    server.stdout.on("data", onData);
    server.stderr.on("data", onData);
    server.on("exit", (code) => reject(new Error(`server exited (${code}):\n${log}`)));
  });
}

app.whenReady().then(async () => {
  try {
    const url = await startServer();
    steps.push(`ok   server up at ${url}`);
    const api = async (p, init) => (await fetch(url + p, init)).json();

    const win = new BrowserWindow({ width: 1240, height: 820, show: false });
    await win.loadURL(url);
    const js = (code) => win.webContents.executeJavaScript(code);

    await waitFor("UI renders the rail", () => js(`!!document.querySelector(".rail-actions")`));
    await js(`[...document.querySelectorAll(".rail-actions button")].find(b => b.textContent.includes("shell"))?.click()`);

    const session = await waitFor("server has the new shell session", async () =>
      (await api("/api/sessions")).sessions.find((s) => s.shell && s.status === "running"),
    );
    await waitFor("rail lists the session", () => js(`document.querySelectorAll(".session-close").length === 1`));
    await waitFor("terminal attaches and draws a prompt", () =>
      js(`(document.querySelector(".xterm-rows")?.textContent ?? "").trim().length > 0`),
    );

    // Type a command whose output differs from its own echo, so seeing the
    // result proves the round trip: keystrokes to the PTY, output back over
    // the WebSocket, drawn by xterm.
    await js(`document.querySelector(".xterm-helper-textarea")?.focus()`);
    for (const ch of "echo den-smoke-$((6*7))") win.webContents.sendInputEvent({ type: "char", keyCode: ch });
    win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Return" });
    win.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
    win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Return" });
    await waitFor("typed command's output comes back", () =>
      js(`(document.querySelector(".xterm-rows")?.textContent ?? "").includes("den-smoke-42")`),
    );

    // Close it the way you would, from the rail (the rail's poll only merges
    // rows it already has, so a close from elsewhere wouldn't show there).
    await js(`document.querySelector(".session-close")?.click()`);
    await waitFor("closing from the rail removes it", () => js(`document.querySelectorAll(".session-close").length === 0`));
    await waitFor("and the server's session is gone", async () =>
      !(await api("/api/sessions")).sessions.some((s) => s.id === session.id),
    );

    done(0, `${steps.join("\n")}\nSMOKE OK`);
  } catch (err) {
    done(1, `${steps.join("\n")}\nFAIL ${err.message}`);
  }
});
