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
  /** Shell command that tears it down (run in `dir`), for the stop button.
   * Absent for a script app, which stops with Ctrl-C in its tab. */
  stopCommand?: string;
  /** runn: how many of the stack's containers are up (0 = nothing to stop). */
  containersUp?: number;
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
export function parseRunnStatus(out: string): { running: boolean; url?: string; containersUp: number } {
  const url = out.match(/^App:\s*(\S+)/m)?.[1];
  const lines = out.split("\n");
  // The app container line looks like: "runn_<proj>-app-1  ...  Up ... (healthy)"
  const running = lines.some((l) => /-app-\d+\b/.test(l) && /\bUp\b/.test(l));
  // Any container up means the stack holds memory, even when the app itself
  // has exited: that's what the stop button is for (#28).
  const containersUp = lines.filter((l) => /^runn_\S+-\d+\s/.test(l) && /\bUp\b/.test(l)).length;
  return { running, url, containersUp };
}

/** The repo's own teardown command: `conductor.json`'s `scripts.archive`
 * (the Conductor app's convention; runn declares `runn down` there). */
export function archiveCommandFor(root: string): string | null {
  try {
    const c = JSON.parse(readFileSync(join(root, "conductor.json"), "utf8")) as { scripts?: { archive?: unknown } };
    const a = c.scripts?.archive;
    return typeof a === "string" && a.trim() ? a.trim() : null;
  } catch {
    return null;
  }
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
      stopCommand: archiveCommandFor(dir) ?? "runn down",
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
      const { running, url, containersUp } = parseRunnStatus(stdout);
      return { ...base, running, url: url ?? base.url, containersUp };
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

// --- Worktree setup (#10) ----------------------------------------------------
// A fresh worktree of the work repo isn't ready to run: the repo's gitignored
// local files (.env, generated artifacts, node_modules) live only in the main
// checkout. Repos say how to bring one up themselves, so den reads that rather
// than carrying anyone's setup steps: `conductor.json`'s `scripts.setup` (the
// Conductor app's convention; runn declares `./scripts/setup-worktree.sh`
// there), else a `scripts/setup-worktree.sh`. Whether it's needed comes from
// `.worktreeinclude` (Claude Code's list of gitignored files a worktree
// should have): a listed path the main checkout has and this worktree lacks.

export interface WorktreeSetup {
  /** Shell command that sets this worktree up (run in `dir`), or null. */
  command: string | null;
  /** Where the command came from, for the tooltip. */
  source: string | null;
  /** The worktree's root. */
  dir: string;
  /** This is the repo's own checkout, not an added worktree: nothing to copy in. */
  main: boolean;
  /** Paths the main checkout has and this worktree is missing. */
  missing: string[];
}

/** The repo's own setup command, from conductor.json or a setup script. */
export function setupCommandFor(root: string): { command: string; source: string } | null {
  try {
    const conductor = JSON.parse(readFileSync(join(root, "conductor.json"), "utf8")) as {
      scripts?: { setup?: unknown };
    };
    const setup = conductor.scripts?.setup;
    if (typeof setup === "string" && setup.trim()) {
      return { command: setup.trim(), source: "conductor.json" };
    }
  } catch {
    // no conductor.json, or not JSON
  }
  if (existsSync(join(root, "scripts", "setup-worktree.sh"))) {
    return { command: "./scripts/setup-worktree.sh", source: "scripts/setup-worktree.sh" };
  }
  return null;
}

/** The plain paths (no globs) a `.worktreeinclude` lists. Pure, for the test. */
export function literalIncludes(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!") && !/[*?[\]]/.test(l))
    .map((l) => l.replace(/^\/+/, "").replace(/\/+$/, ""))
    .filter((l) => l && !l.includes(".."));
}

/** The main checkout of the repo `root` belongs to. A worktree's `.git` is a
 * file pointing at `<main>/.git/worktrees/<name>`; the main checkout's is a
 * directory. */
export function mainCheckoutOf(root: string): string {
  try {
    const dotGit = readFileSync(join(root, ".git"), "utf8");
    const gitdir = dotGit.match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
    const m = gitdir?.match(/^(.*)\/\.git\/worktrees\/[^/]+$/);
    if (m) return m[1];
  } catch {
    // .git is a directory (EISDIR): this is the main checkout
  }
  return root;
}

export function detectSetup(cwd: string): WorktreeSetup {
  const dir = repoRoot(cwd);
  const main = mainCheckoutOf(dir);
  const found = setupCommandFor(dir) ?? setupCommandFor(main);
  const isMain = main === dir;
  const missing: string[] = [];
  if (!isMain) {
    // The repo's own list when it has one (runn's setup copies node_modules
    // only on request, so checking it there would never clear); otherwise the
    // one thing every JS checkout needs.
    let wanted: string[];
    try {
      wanted = literalIncludes(readFileSync(join(dir, ".worktreeinclude"), "utf8"));
    } catch {
      wanted = existsSync(join(dir, "package.json")) ? ["node_modules"] : [];
    }
    for (const p of wanted) {
      if (existsSync(join(main, p)) && !existsSync(join(dir, p))) missing.push(p);
    }
  }
  return { command: found?.command ?? null, source: found?.source ?? null, dir, main: isMain, missing };
}

/** A line for a workspace pane's system prompt when its checkout is a worktree
 * with a setup command, so Claude knows the likely fix when a test or the app
 * fails on a missing .env or dependency. ASCII, like every den prompt. Empty
 * when there's nothing to say. */
export function setupHint(cwd: string): string {
  const s = detectSetup(cwd);
  if (s.main || !s.command) return "";
  const state = s.missing.length
    ? `It looks not set up yet: ${s.missing.join(", ")} ${s.missing.length === 1 ? "is" : "are"} missing here.`
    : "It looks set up.";
  return (
    `This checkout is a git worktree of the repo. The repo's command for ` +
    `setting up a fresh worktree is \`${s.command}\` (from ${s.source}), run ` +
    `from ${s.dir}. ${state} If tests or the app fail for environment reasons ` +
    `(a missing .env, dependencies, or generated files), that command is the ` +
    `likely fix: suggest it to the developer, who can run it from den's ` +
    `"set up" button, rather than recreating files by hand.`
  );
}
