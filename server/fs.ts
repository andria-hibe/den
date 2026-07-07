import { readdirSync, statSync, existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, join, dirname, sep } from "node:path";

// All filesystem browsing is sandboxed to the home directory — this is a local
// personal tool, but there's no reason to let the UI wander the whole disk.
const HOME = homedir();

export interface DirEntry {
  name: string;
  path: string;
}

/** String-level check: is the (already-resolved) path under HOME? */
function underHome(r: string): boolean {
  return r === HOME || r.startsWith(HOME + sep);
}

/**
 * True if `p` is inside HOME even after resolving symlinks. `resolve()` alone
 * collapses `..` and absolute paths (blocking those), but a symlink *inside*
 * HOME can still point outside it — so we also realpath the nearest existing
 * ancestor and re-check. Paths that don't exist yet (e.g. a makeDir target) are
 * fine as long as their real, existing parent stays under HOME.
 */
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

/** Well-known starting points offered in the New Session dialog. */
export function roots() {
  const documents = join(HOME, "Documents");
  return {
    home: HOME,
    documents,
    work: join(documents, "work"),
    runn: join(documents, "work", "runn"),
    projects: join(documents, "projects"),
    den: denRepo(),
  };
}

/**
 * The den *source* repo, for the "edit den" self-editing session. NOT the
 * packaged /Applications/Den.app (editing that is useless) — the checkout you
 * actually develop in. Prefers $DEN_REPO, then the usual location, then the dev
 * cwd; only returns a path that actually looks like the den source.
 */
export function denRepo(): string | null {
  const candidates = [
    process.env.DEN_REPO,
    join(HOME, "Documents", "projects", "den"),
    process.cwd(),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    const r = resolve(c);
    if (
      within(r) &&
      existsSync(join(r, "server", "app.ts")) &&
      existsSync(join(r, "package.json"))
    ) {
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
      // follow symlinks that point at directories
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
