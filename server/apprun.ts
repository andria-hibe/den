// "Run this app locally" support for the workspace header button.
//
// Given a workspace's cwd, figure out whether the app it belongs to can be run
// locally, how to spin it up, and (when we can tell) whether it's already up and
// what URL to open. Two recipes:
//   - "runn": a runn checkout (has .runn/project.env). We can ask `runn status`
//     for liveness + the app URL, and `runn up` spins it up.
//   - "script": any repo with a dev-ish npm script. We can spin it up (run the
//     script in a terminal) but can't generically know if it's already running.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { homedir } from "node:os";
import { createConnection } from "node:net";
import { logWarn } from "./log.ts";

const exec = promisify(execFile);
const HOME = homedir();

export interface AppRunner {
  /** Display name of the app (repo dir basename). */
  name: string;
  /** How we know to run it, or null if we found no way. */
  kind: "runn" | "script" | null;
  /** Whether it appears to be running. null = we can't tell (script recipe). */
  running: boolean | null;
  /** URL to open when running, if known. */
  url?: string;
  /** Shell command that spins it up (run in `dir`). */
  command?: string;
  /** Working dir the command runs in (repo root). */
  dir: string;
}

/** Walk up from cwd to the enclosing git repo root (bounded to $HOME). */
function repoRoot(cwd: string): string {
  let d = cwd;
  while (d.startsWith(HOME) && d !== HOME) {
    if (existsSync(join(d, ".git"))) return d;
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return cwd;
}

/** Build the runn app URL from the per-worktree ports file, if present. */
function runnUrlFromEnv(dir: string): string | undefined {
  try {
    const env = readFileSync(join(dir, ".runn", "project.env"), "utf8");
    const host = env.match(/^RUNN_PROJECT_HOSTNAME=(.+)$/m)?.[1]?.trim();
    const port = env.match(/^RUNN_PORT_APP=(\d+)$/m)?.[1]?.trim();
    if (host && port) return `https://${host}:${port}`;
  } catch {
    // no ports file / unreadable — fall back to `runn status` output
  }
  return undefined;
}

/** Parse `runn status` output for liveness + the app URL. */
export function parseRunnStatus(out: string): { running: boolean; url?: string } {
  const url = out.match(/^App:\s*(\S+)/m)?.[1];
  // The app container line looks like: "runn_<proj>-app-1  ...  Up ... (healthy)"
  const running = out
    .split("\n")
    .some((l) => /-app-\d+\b/.test(l) && /\bUp\b/.test(l));
  return { running, url };
}

const DEV_SCRIPTS = ["dev", "start", "develop", "serve", "turbo:dev"];

/** The first dev-ish script present in the repo's package.json, if any. */
export function pickDevScript(dir: string): string | undefined {
  return pickDevScriptEntry(dir)?.name;
}

/** The chosen dev script's name + body, for port sniffing. */
function pickDevScriptEntry(dir: string): { name: string; body: string } | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const name = DEV_SCRIPTS.find((s) => typeof scripts[s] === "string");
    return name ? { name, body: scripts[name] } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pull an *explicitly declared* port out of a dev script (`--port 4000`, `-p
 * 4000`, `PORT=4000`). We deliberately don't guess tool defaults (5173, 3000,
 * …) — probing a default could hit an unrelated app and mislabel it "running".
 */
export function extractPort(script: string): number | undefined {
  const m = script.match(/(?:--port[=\s]|(?<![\w-])-p[=\s]|\bPORT=)(\d{2,5})\b/);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 65535 ? n : undefined;
}

/** True if something is already listening on the local port (app is up). */
function probePort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = createConnection({ port, host: "127.0.0.1" });
    const finish = (up: boolean) => {
      sock.destroy();
      resolve(up);
    };
    sock.setTimeout(700);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
  });
}

/** Detect the package manager from lockfiles (defaults to npm). */
function detectPm(dir: string): string {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb"))) return "bun";
  return "npm";
}

/** Static detection (no subprocess): what/how, but not liveness. */
export function detectAppRunner(cwd: string): AppRunner {
  const dir = repoRoot(cwd);
  const name = basename(dir);
  // runn takes precedence — it has a richer status/open story than a raw script.
  if (existsSync(join(dir, ".runn", "project.env"))) {
    return {
      name,
      kind: "runn",
      running: null,
      dir,
      command: "runn up",
      url: runnUrlFromEnv(dir),
    };
  }
  const script = pickDevScriptEntry(dir);
  if (script) {
    const port = extractPort(script.body);
    return {
      name,
      kind: "script",
      running: null,
      dir,
      command: `${detectPm(dir)} run ${script.name}`,
      url: port ? `http://localhost:${port}` : undefined,
    };
  }
  return { name, kind: null, running: null, dir };
}

/**
 * Detection + liveness. runn asks `runn status`; a script app is probed on its
 * declared port (if any). Knowing it's up lets the UI offer "open" instead of
 * "run" — so we never re-launch an app that's already running.
 */
export async function appRunnerStatus(cwd: string): Promise<AppRunner> {
  const base = detectAppRunner(cwd);
  if (base.kind === "runn") {
    try {
      const { stdout } = await exec("runn", ["status"], {
        cwd: base.dir,
        timeout: 8000,
      });
      const { running, url } = parseRunnStatus(stdout);
      return { ...base, running, url: url ?? base.url };
    } catch (e) {
      // `runn` missing or errored — still offer to spin it up; treat as down.
      logWarn("runn status failed", e);
      return { ...base, running: false };
    }
  }
  if (base.kind === "script" && base.url) {
    const port = Number(new URL(base.url).port);
    return { ...base, running: port ? await probePort(port) : null };
  }
  return base;
}
