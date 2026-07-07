import { app, BrowserWindow, Menu, shell } from "electron";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { startServer, type RunningServer } from "../server/app.ts";

// Bundled to dist/electron/main.cjs (esbuild), so __dirname is dist/electron.
let server: RunningServer | null = null;

// A double-clicked macOS app inherits a minimal PATH that omits Homebrew, nvm,
// ~/.local/bin, etc. — so `claude` and `gh` wouldn't be found. Pull the real
// PATH from an interactive login shell.
function fixPath() {
  if (process.platform === "win32") return;
  try {
    const shellBin = process.env.SHELL || "/bin/zsh";
    const out = execFileSync(shellBin, ["-lic", 'echo -n "$PATH"'], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (out && out.includes("/")) process.env.PATH = out.trim();
  } catch {
    // keep the inherited PATH
  }
}

// Den is a single-window cockpit and binds Cmd+W itself (close the active
// *session*, not the window). The default macOS menu binds Cmd+W to "Close
// Window" at the native level, which would swallow that keystroke before the
// renderer sees it — so install a menu that keeps the standard Edit/View roles
// (copy/paste/undo/quit) but drops the Cmd+W accelerator. Quit is still Cmd+Q.
function installMenu() {
  if (process.platform !== "darwin") return; // default menu is fine elsewhere
  const template: Electron.MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function boot() {
  fixPath();
  installMenu();
  const webDir = app.isPackaged
    ? join(process.resourcesPath, "web")
    : join(__dirname, "..", "web"); // dist/electron -> dist/web

  server = await startServer({ port: 0, webDir });

  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 860,
    minHeight: 540,
    backgroundColor: "#fdf6fb",
    title: "den",
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  win.loadURL(server.url);

  // PR cards etc. use target=_blank — send those to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Smoke test: verify boot end-to-end then quit (used in CI/verification).
  if (process.env.DEN_SMOKE) {
    win.webContents.once("did-finish-load", () => {
      console.log(`SMOKE_OK ${server?.url}`);
      setTimeout(() => app.quit(), 200);
    });
    win.webContents.once("did-fail-load", (_e, code, desc) => {
      console.error(`SMOKE_FAIL ${code} ${desc}`);
      app.quit();
    });
  }
}

app.whenReady().then(boot);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) boot();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await server?.close().catch(() => {});
});
