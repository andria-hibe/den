// Build better-sqlite3's native binary for Electron into
// native/electron-<version>/, leaving node_modules built for Node (#20).
//
// Only better-sqlite3 needs this. node-pty is built on N-API, whose ABI is
// stable across runtimes, so the one binary in node_modules loads in Node and
// Electron alike. better-sqlite3 uses V8's ABI, which differs between them, so
// den keeps one copy per runtime and picks at load time (server/store.ts
// passes this file as `nativeBinding` when running under Electron). Before
// this, the one copy in node_modules had to be rebuilt every time you switched
// between `npm run dev` and `npm run app`.
//
//   node scripts/native-electron.mjs [--force]
//
// Skips the build when the binary for the installed Electron already exists.
// The build runs on a copy of the package in a temp dir, so node_modules
// itself is never touched.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));
const electronVersion = require("electron/package.json").version;
const outDir = join(root, "native", `electron-${electronVersion}`);
const out = join(outDir, "better_sqlite3.node");

if (existsSync(out) && !process.argv.includes("--force")) {
  console.log(`native-electron: ${out.replace(root + "/", "")} is up to date`);
  process.exit(0);
}

// Build a copy of the package outside the repo with node-gyp against
// Electron's headers. Not electron-rebuild: it walks up the directory tree and
// rebuilds node_modules/better-sqlite3 in place as well, the exact thing this
// script exists to avoid.
const work = mkdtempSync(join(tmpdir(), "den-native-"));
const pkg = join(work, "better-sqlite3");
cpSync(join(root, "node_modules", "better-sqlite3"), pkg, {
  recursive: true,
  filter: (src) => !src.startsWith(join(root, "node_modules", "better-sqlite3", "build")),
});

console.log(`native-electron: building better-sqlite3 for Electron ${electronVersion}...`);
try {
  execFileSync(
    join(root, "node_modules", ".bin", "node-gyp"),
    [
      "rebuild",
      "--release",
      `--target=${electronVersion}`,
      `--arch=${process.arch}`,
      "--dist-url=https://electronjs.org/headers",
      "--runtime=electron",
    ],
    { cwd: pkg, stdio: ["ignore", "ignore", "inherit"] },
  );
  mkdirSync(outDir, { recursive: true });
  copyFileSync(join(pkg, "build", "Release", "better_sqlite3.node"), out);
  console.log(`native-electron: wrote ${out.replace(root + "/", "")}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
