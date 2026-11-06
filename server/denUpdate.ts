// "Update den": build den's checkout into a new app bundle and swap it in.
// The developer controls when the running app is replaced, so nothing here
// runs without a click, and the swap itself happens only once den has quit
// (scripts/install-den.sh): a running den execs node-pty's spawn-helper from
// its bundle, so replacing the bundle under it breaks every new terminal.
import { execFile, execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./dataDir.ts";
import { logWarn } from "./log.ts";

declare const DEN_BUILD_COMMIT: string | undefined;

/** The commit this app was built from: set by scripts/build-electron.mjs,
 * empty for a build with uncommitted changes, undefined outside a build. */
export function installedCommit(): string | null {
  return typeof DEN_BUILD_COMMIT === "string" && DEN_BUILD_COMMIT ? DEN_BUILD_COMMIT : null;
}

const APP = "/Applications/Den.app";
const STAGED = `${APP}.new`;
const LOG = join(DATA_DIR, "update.log");
// The commit the staged bundle was built from, so a staged build survives a
// den restart and one older than the checkout isn't offered for install.
const STAGED_COMMIT = join(DATA_DIR, "update-staged.txt");

/** "staged" is derived from the staged bundle on disk, never held here. */
type RunState = "idle" | "building" | "failed";
export type UpdateState = RunState | "staged";
let state: RunState = "idle";

function stagedCommit(): string | null {
  try {
    return existsSync(STAGED) ? readFileSync(STAGED_COMMIT, "utf8").trim() || null : null;
  } catch {
    return null;
  }
}

export interface UpdateStatus {
  /** False outside the packaged app, or when den's checkout can't be found. */
  available: boolean;
  installed: string | null;
  head: string | null;
  /** Subjects of the commits the checkout has that this app lacks, newest first. */
  commits: string[];
  /** Uncommitted changes in the checkout, which a build would ship. */
  dirty: boolean;
  state: UpdateState;
}

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 5000 }).trim();

export function updateStatus(repo: string | null, packaged: boolean): UpdateStatus {
  const installed = installedCommit();
  const none: UpdateStatus = { available: false, installed, head: null, commits: [], dirty: false, state: "idle" };
  if (!repo || !packaged) return none;
  try {
    const head = git(repo, "rev-parse", "HEAD");
    const dirty = git(repo, "status", "--porcelain") !== "";
    let commits: string[] = [];
    if (installed !== head) {
      // An unknown or unstamped install: say there's an update without a list.
      const range = installed && isAncestor(repo, installed, head) ? `${installed}..${head}` : `${head}~1..${head}`;
      commits = git(repo, "log", "--format=%s", range).split("\n").filter(Boolean);
    }
    const staged = state === "idle" && stagedCommit() === head && head !== installed;
    return { available: true, installed, head, commits, dirty, state: staged ? "staged" : state };
  } catch (err) {
    logWarn("den update status", err);
    return none;
  }
}

function isAncestor(repo: string, a: string, b: string): boolean {
  try {
    execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", a, b], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/** Build den's checkout and stage the bundle at /Applications/Den.app.new.
 * Resolves when the build is under way; `state` says how it went. */
export function buildUpdate(repo: string): "started" | "busy" | "dirty" | "failed" {
  if (state === "building") return "busy";
  let head: string;
  try {
    if (git(repo, "status", "--porcelain") !== "") return "dirty";
    head = git(repo, "rev-parse", "HEAD");
  } catch (err) {
    logWarn("den update build", err);
    return "failed";
  }
  state = "building";
  rmSync(STAGED_COMMIT, { force: true });
  const log = createWriteStream(LOG);
  log.on("error", (err) => logWarn("den update log", err));
  log.write(`${new Date().toISOString()} building ${head}\n`);
  const pack = spawn("npm", ["run", "pack"], { cwd: repo, env: process.env });
  pack.stdout.pipe(log, { end: false });
  pack.stderr.pipe(log, { end: false });
  pack.on("error", (err) => {
    log.end(`\n${String(err)}\n`);
    state = "failed";
  });
  pack.on("close", (code) => {
    if (code !== 0) {
      log.end(`\nnpm run pack exited ${code}\n`);
      state = "failed";
      return;
    }
    rmSync(STAGED, { recursive: true, force: true });
    execFile("ditto", [join(repo, "release", "mac-arm64", "Den.app"), STAGED], (err) => {
      log.end(err ? `\nstaging failed: ${String(err)}\n` : `\nstaged at ${STAGED}\n`);
      if (!err) writeFileSync(STAGED_COMMIT, head);
      state = err ? "failed" : "idle";
    });
  });
  return "started";
}

/** Quit den and swap the staged bundle in. The script detaches first, so it
 * outlives den. */
export function installUpdate(repo: string): "started" | "not_staged" {
  if (state !== "idle" || !stagedCommit()) return "not_staged";
  execFile(join(repo, "scripts", "install-den.sh"), (err) => {
    if (err) logWarn("den install", err);
  });
  return "started";
}

/** The end of the build log, to show why a build failed. */
export function updateLogTail(): string {
  try {
    return execFileSync("tail", ["-n", "15", LOG], { encoding: "utf8" });
  } catch {
    return "";
  }
}
