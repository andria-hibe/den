import { readdirSync, statSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join, dirname, sep } from "node:path";
import { store } from "./store.ts";
import { isValidBranch } from "../shared/branch.ts";

const DEN_REPO_SETTING = "den_repo_path";

// Filesystem browsing is sandboxed to the home directory.
const HOME = homedir();

export interface DirEntry {
  name: string;
  path: string;
}

/** String-level check on an already-resolved path. */
function underHome(r: string): boolean {
  return r === HOME || r.startsWith(HOME + sep);
}

/** Is `p` inside HOME even after resolving symlinks? `resolve()` alone misses
 * a symlink inside HOME that points outside it, so the nearest existing
 * ancestor is realpathed too; that also covers paths that don't exist yet. */
export function within(p: string): boolean {
  const r = resolve(p);
  if (!underHome(r)) return false;
  let cur = r;
  while (!existsSync(cur)) {
    const parent = dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
  try {
    return underHome(realpathSync(cur));
  } catch {
    return false;
  }
}

const WORK_DIR_SETTING = "work_dir";

/** If exactly one direct child of `dir` is a git repo, return its path. */
export function soleGitRepo(dir: string): string | null {
  const repos: string[] = [];
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      try {
        if (statSync(p).isDirectory() && existsSync(join(p, ".git"))) repos.push(p);
      } catch {
        // unreadable entry — skip
      }
    }
  } catch {
    return null; // dir missing / unreadable
  }
  return repos.length === 1 ? repos[0] : null;
}

/** The primary work repo that Work sessions and PR/ticket checkouts default
 * into. It must be a git repo, since prepareWork and checkoutPr run git in
 * it. */
export function workDir(): string {
  const work = join(HOME, "Documents", "work");
  for (const c of [process.env.DEN_WORK_DIR, store.getSetting(WORK_DIR_SETTING)]) {
    if (!c) continue;
    const abs = c.startsWith("~") ? join(HOME, c.slice(1)) : resolve(c);
    if (within(abs) && existsSync(abs)) return abs;
  }
  return soleGitRepo(work) ?? work;
}

const BASE_BRANCH_SETTING = "base_branch";

/** The configured base branch for new work branches, for a repo whose team
 * doesn't work off its default branch. Null means git.ts asks the repo. */
export function baseBranchOverride(): string | null {
  for (const c of [process.env.DEN_BASE_BRANCH, store.getSetting(BASE_BRANCH_SETTING)]) {
    const name = c?.trim();
    if (name && isValidBranch(name)) return name;
  }
  return null;
}

/** Well-known starting points offered in the New Session dialog. */
export function roots() {
  const documents = join(HOME, "Documents");
  return {
    home: HOME,
    documents,
    work: join(documents, "work"),
    workRepo: workDir(),
    projects: join(documents, "projects"),
    den: denRepo(),
  };
}

function looksLikeDenRepo(r: string): boolean {
  return (
    within(r) &&
    existsSync(join(r, "server", "app.ts")) &&
    existsSync(join(r, "package.json"))
  );
}

/** The den source checkout, for the "edit den" session. Once found (e.g.
 * under `npm run dev`, whose cwd is the repo) it's saved to the settings
 * store, which the packaged app shares, so the app finds the repo even though
 * it runs from its bundle. */
export function denRepo(): string | null {
  const candidates = [
    process.env.DEN_REPO,
    store.getSetting(DEN_REPO_SETTING),
    join(HOME, "Documents", "projects", "den"),
    process.cwd(),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    const r = resolve(c);
    if (looksLikeDenRepo(r)) {
      if (store.getSetting(DEN_REPO_SETTING) !== r) {
        store.setSetting(DEN_REPO_SETTING, r);
      }
      return r;
    }
  }
  return null;
}

export function isDir(p: string): boolean {
  try {
    const r = resolve(p);
    return within(r) && existsSync(r) && statSync(r).isDirectory();
  } catch {
    return false;
  }
}

export function listDirs(p: string): {
  path: string;
  parent: string | null;
  dirs: DirEntry[];
} {
  const path = resolve(p);
  if (!within(path)) throw new Error("outside_home");
  if (!isDir(path)) throw new Error("not_found");
  const dirs = readdirSync(path, { withFileTypes: true })
    .filter((e) => {
      if (e.name.startsWith(".")) return false;
      if (e.isDirectory()) return true;
      if (e.isSymbolicLink()) return isDir(join(path, e.name));
      return false;
    })
    .map((e) => ({ name: e.name, path: join(path, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const up = dirname(path);
  return { path, parent: up !== path && within(up) ? up : null, dirs };
}

export function makeDir(parent: string, name: string): string {
  const clean = name.trim().replace(/[/\\]/g, "");
  if (!clean) throw new Error("bad_name");
  const path = resolve(join(parent, clean));
  if (!within(path)) throw new Error("outside_home");
  mkdirSync(path, { recursive: true });
  return path;
}
