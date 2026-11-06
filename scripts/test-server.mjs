// An isolated den server for checking a change by hand or from a subagent:
// its own data dir and database (never the installed app's ~/.den), no idle
// handovers, none of a surrounding Claude session's variables, and
// scripts/stub-claude in place of `claude` unless --real-claude is given.
//
//   node scripts/test-server.mjs [--port 4399] [--dir <data dir>] [--real-claude]
//
// Prints the URL, the data dir, and where the stub writes each pane's args
// and input. Runs until stopped. It serves the API only: for the UI, run it
// on --port 4321 and `npm run dev:web` (Vite proxies /api and /ws there).
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const dir = resolve(arg("--dir") ?? mkdtempSync(join(tmpdir(), "den-test-")));
const stubDir = join(dir, "stub-claude");
mkdirSync(stubDir, { recursive: true });

const env = {
  ...process.env,
  PORT: arg("--port") ?? "4399",
  DEN_DATA_DIR: dir,
  DEN_DB: join(dir, "den.db"),
  DEN_IDLE_HANDOVER_MIN: "0",
  STUB_CLAUDE_DIR: stubDir,
};
for (const k of Object.keys(env)) if (k.startsWith("CLAUDE")) delete env[k];
if (!process.argv.includes("--real-claude")) env.MC_CLAUDE_BIN = join(ROOT, "scripts", "stub-claude");

console.log(`data dir: ${dir}\nstub claude writes to: ${stubDir}`);
const server = spawn("npx", ["tsx", "server/index.ts"], { cwd: ROOT, env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));
server.on("exit", (code) => process.exit(code ?? 0));
