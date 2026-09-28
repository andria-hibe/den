import { app, BrowserWindow, Menu, screen, shell } from "electron";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { startServer, type RunningServer } from "../server/app.ts";
import { store } from "../server/store.ts";
import { MIN_SIZE, parseWindowState, restoreBounds } from "./windowState.ts";

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

const WINDOW_SETTING = "window_state";

/** Save the window's bounds whenever they settle, and on close. Saving on each
 * move or resize (debounced), not only on close, keeps them if den is killed
 * rather than quit. The normal bounds are saved, so a maximised window
 * restores to its maximised state and still un-maximises to the size it had. */
function rememberBounds(win: BrowserWindow) {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed() || win.isFullScreen() || win.isMinimized()) return;
    const state = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    try {
      store.setSetting(WINDOW_SETTING, JSON.stringify(state));
    } catch {
      // the db is closing on quit; the last debounced save already landed
    }
  };
  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 500);
  };
  win.on("resized", soon);
  win.on("moved", soon);
  win.on("maximize", soon);
  win.on("unmaximize", soon);
  win.on("close", () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

/** Start den's server once per process. On macOS closing the window leaves
 * the app running, and reopening it from the dock used to call the whole boot
 * again: a second server on the same database, whose startup marked every
 * session exited, while the first kept serving the old code. The window is
 * what gets recreated; the server isn't. */
let serverStart: Promise<RunningServer> | null = null;
function ensureServer(): Promise<RunningServer> {
  // The promise, not the result, is shared: a dock click while the first start
  // is still in flight must wait for it, not begin another.
  serverStart ??= startServer({
    port: 0,
    webDir: app.isPackaged
      ? join(process.resourcesPath, "web")
      : join(__dirname, "..", "web"), // dist/electron -> dist/web
  }).then((s) => (server = s));
  return serverStart;
}

async function boot() {
  fixPath();
  installMenu();
  await openWindow();
}

async function openWindow() {
  const server = await ensureServer();

  // Open where the window was last left (see windowState.ts), kept on a
  // display that still exists.
  const saved = parseWindowState(store.getSetting(WINDOW_SETTING));
  const areas = [screen.getPrimaryDisplay(), ...screen.getAllDisplays()].map((d) => d.workArea);
  const win = new BrowserWindow({
    ...restoreBounds(saved, areas),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    backgroundColor: "#fdf6fb",
    title: "den",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  if (saved?.maximized) win.maximize();
  rememberBounds(win);

  win.loadURL(server.url);

  const serverOrigin = new URL(server.url).origin;

  // Only http(s) links may reach the OS (PR/issue URLs). A crafted mailto:/file:/
  // custom-scheme URL arriving from remote data shouldn't be handed to the shell.
  const openExternalIfSafe = (url: string) => {
    try {
      if (["https:", "http:"].includes(new URL(url).protocol)) {
        shell.openExternal(url);
      }
    } catch {
      // not a valid URL — ignore
    }
  };

  // PR cards etc. use target=_blank — send those to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: "deny" };
  });

  // Pin the window to the local app origin: never let in-page navigation carry
  // the renderer off to an arbitrary site (open those externally instead).
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== serverOrigin) {
      e.preventDefault();
      openExternalIfSafe(url);
    }
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

// Reopening from the dock with no window left: a new window on the running
// server (see ensureServer), never a second server.
app.on("activate", () => {
  if (app.isReady() && BrowserWindow.getAllWindows().length === 0) openWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await server?.close().catch(() => {});
});
