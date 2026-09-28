import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * The better-sqlite3 binary for this runtime (#20). node_modules holds the
 * Node build, always; under Electron den loads the Electron build that
 * `npm run native:electron` (scripts/native-electron.mjs) writes to
 * native/electron-<version>/. node-pty needs none of this: it's on N-API, so
 * its one binary loads in both. Undefined means "use node_modules".
 */
export function sqliteBinding(
  electron: string | undefined = process.versions.electron,
  resourcesPath: string | undefined = (process as { resourcesPath?: string }).resourcesPath,
  cwd: string = process.cwd(),
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  if (process.env.DEN_SQLITE_BINDING) return process.env.DEN_SQLITE_BINDING;
  if (!electron) return undefined;
  const rel = join("native", `electron-${electron}`, "better_sqlite3.node");
  const candidates = [
    // The packaged app: native/ ships unpacked next to app.asar.
    resourcesPath ? join(resourcesPath, "app.asar.unpacked", rel) : null,
    // `electron .` from the repo (npm run app).
    join(cwd, rel),
  ];
  return candidates.find((p): p is string => !!p && exists(p));
}
