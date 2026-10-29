// den v2 was built as a second app, Burrow, with its data in ~/.burrow beside
// v1's ~/.den. Now that it's den again, its data takes ~/.den back and v1's is
// kept as ~/.den-v1. Imported first in main.ts, so it runs before the store
// opens a file; only the packaged app does this, never a test or dev server.
import { execFileSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Matched on the executable's path: `pgrep -x` doesn't see an Electron
 * app's main process by name on macOS. */
function running(name: string): boolean {
  try {
    execFileSync("pgrep", ["-f", `/Contents/MacOS/${name}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Burrow still has ~/.burrow open, so moving it now would pull its files
 * out from under it. main.ts asks for it to be quit instead. */
export const burrowRunning = !process.env.DEN_DATA_DIR && running("Burrow");

const burrow = join(homedir(), ".burrow");
const den = join(homedir(), ".den");
if (!process.env.DEN_DATA_DIR && !burrowRunning && existsSync(burrow)) {
  if (existsSync(den)) renameSync(den, `${den}-v1`);
  renameSync(burrow, den);
}
