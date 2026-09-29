// How to run a workspace's app locally, for the workspace header button: a
// runn checkout (`runn up`, liveness from `runn status`) or a dev-ish npm
// script, whose liveness is known only when it declares a port.
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
  name: string;
  /** null when there's no known way to run it. */
  kind: "runn" | "script" | null;
  /** null = can't tell. */
  running: boolean | null;
  url?: string;
  /** Run in `dir`. */
  command?: string;
  /** Run in `dir`. Absent for a script app, which stops with Ctrl-C in its tab. */
  stopCommand?: string;
  /** runn: how many of the stack's containers are up (0 = nothing to stop). */
  containersUp?: number;
  /** The repo root. */
  dir: string;
}

/** The enclosing git repo root, searching no higher than $HOME. */
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
    // no ports file: `runn status` supplies the URL instead
  }
  return undefined;
}

/** Parse `runn status` output for liveness + the app URL. */
export function parseRunnStatus(out: string): { running: boolean; url?: string; containersUp: number } {
  const url = out.match(/^App:\s*(\S+)/m)?.[1];
  const lines = out.split("\n");
  // e.g. "runn_<proj>-app-1  ...  Up ... (healthy)"
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

export function pickDevScript(dir: string): string | undefined {
  return pickDevScriptEntry(dir)?.name;
}

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

/** The port a dev script explicitly declares. Tool defaults (5173, 3000) are
 * never guessed: probing one could hit an unrelated app and mislabel it
 * "running". */
export function extractPort(script: string): number | undefined {
  const m = script.match(/(?:--port[=\s]|(?<![\w-])-p[=\s]|\bPORT=)(\d{2,5})\b/);
  const n = m ? Number(m[1]) : NaN;
  return n >= 1 && n <= 65535 ? n : undefined;
}

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

function detectPm(dir: string): string {
  if (existsSync(join(dir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(dir, "yarn.lock"))) return "yarn";
  if (existsSync(join(dir, "bun.lockb"))) return "bun";
  return "npm";
}

function isRunnRepo(dir: string): boolean {
  return [dir, mainCheckoutOf(dir)].some((d) => existsSync(join(d, ".runn", "project.env")));
}

/** How to run the app, without spawning anything; no liveness. */
export function detectAppRunner(cwd: string): AppRunner {
  const dir = repoRoot(cwd);
  const name = basename(dir);
  // runn first: it can report liveness and the URL, a raw script can't. A
  // fresh worktree has no ports file until its first `runn up`, so the main
  // checkout's counts too.
  if (isRunnRepo(dir)) {
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

/** detectAppRunner plus liveness, so the UI offers "open" rather than
 * re-launching an app that's already up. */
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
      // Still offer to start it.
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
// A fresh worktree lacks the repo's gitignored local files (.env, generated
// artifacts), which live only in the main checkout. den runs the repo's own
// setup command rather than carrying anyone's setup steps.

export interface WorktreeSetup {
  /** Run in `dir`. */
  command: string | null;
  /** Where the command came from, for the tooltip. */
  source: string | null;
  dir: string;
  /** The repo's own checkout: nothing to set up. */
  main: boolean;
  /** Paths the main checkout has and this worktree lacks. */
  missing: string[];
  /** Run after `command` to install dependencies. */
  then: string | null;
}

/** `conductor.json`'s `scripts.setup` (the Conductor app's convention), else
 * `scripts/setup-worktree.sh`. */
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

/** The plain paths (no globs) a `.worktreeinclude` lists. */
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
    // `.worktreeinclude` is Claude Code's list of gitignored files a worktree
    // should have. node_modules only without one: runn's setup copies it only
    // on request, so checking it there would never clear.
    let wanted: string[];
    try {
      wanted = literalIncludes(readFileSync(join(dir, ".worktreeinclude"), "utf8"));
    } catch {
      wanted = existsSync(join(dir, "package.json")) ? ["node_modules"] : [];
    }
    for (const p of wanted) {
      // A parent the worktree lacks is a layout the repo has moved off (a
      // stale `.worktreeinclude`, an old main checkout still holding it); no
      // setup recreates it.
      if (!existsSync(join(dir, dirname(p)))) continue;
      if (existsSync(join(main, p)) && !existsSync(join(dir, p))) missing.push(p);
    }
  }
  return {
    command: found?.command ?? null,
    source: found?.source ?? null,
    dir,
    main: isMain,
    missing,
    then: isMain ? null : dependencyStep(dir),
  };
}

/** runn installs dependencies into its Docker stack (the host node_modules
 * is an empty mount point), so its step is `runn up`; a plain node repo's is
 * an install, only while it has none. */
function dependencyStep(dir: string): string | null {
  const runner = detectAppRunner(dir);
  if (runner.kind === "runn") return runner.command ?? null;
  if (existsSync(join(dir, "package.json")) && !existsSync(join(dir, "node_modules"))) {
    return `${detectPm(dir)} install`;
  }
  return null;
}

/** What the set-up button types. */
export function setupScript(s: WorktreeSetup): string | null {
  if (!s.command) return null;
  return s.then ? `${s.command} && ${s.then}` : s.command;
}

/** A line for a workspace pane's system prompt naming the worktree's setup
 * command, so Claude knows the likely fix when something fails on a missing
 * .env or dependency. Empty when there's nothing to say. */
export function setupHint(cwd: string): string {
  const s = detectSetup(cwd);
  if (s.main || !s.command) return "";
  const state = s.missing.length
    ? `It looks not set up yet: ${s.missing.join(", ")} ${s.missing.length === 1 ? "is" : "are"} missing here.`
    : "It looks set up.";
  return (
    `This checkout is a git worktree of the repo. The repo's command for ` +
    `setting up a fresh worktree is \`${s.command}\` (from ${s.source})` +
    (s.then ? `, followed by \`${s.then}\` for its dependencies` : "") +
    `, run from ${s.dir}. ${state} If tests or the app fail for environment reasons ` +
    `(a missing .env, dependencies, or generated files), that command is the ` +
    `likely fix: suggest it to the developer, who can run it from den's ` +
    `"set up" button, rather than recreating files by hand.`
  );
}
