// node-pty ships a `spawn-helper` binary in its prebuilds, but npm's tarball
// extraction can drop the executable bit — causing `posix_spawnp failed` at
// runtime on macOS/Linux. Restore +x after install.
import { chmodSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const prebuilds = join(root, "node_modules", "node-pty", "prebuilds");

const helpers = [
  "darwin-arm64/spawn-helper",
  "darwin-x64/spawn-helper",
  "linux-arm64/spawn-helper",
  "linux-x64/spawn-helper",
];

for (const rel of helpers) {
  const p = join(prebuilds, rel);
  if (existsSync(p)) {
    try {
      chmodSync(p, 0o755);
      console.log(`fix-pty: chmod +x ${rel}`);
    } catch (err) {
      console.warn(`fix-pty: could not chmod ${rel}:`, err.message);
    }
  }
}
