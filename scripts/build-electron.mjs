// Bundles electron/main.ts, stamping the commit it was built from so the
// app can tell when den's checkout has moved past it ("update den").
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
let commit = "";
try {
  // A build with uncommitted changes isn't any commit, so it's never "up to date".
  commit = git("status", "--porcelain") ? "" : git("rev-parse", "HEAD");
} catch {
  // not a git checkout
}

await build({
  entryPoints: ["electron/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  packages: "external",
  outfile: "dist/electron/main.cjs",
  define: { DEN_BUILD_COMMIT: JSON.stringify(commit) },
});
