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

// Den binds Cmd+W to close the active session. The default macOS menu binds it
// natively to "Close Window", which swallows the keystroke before the renderer
// sees it, so this menu keeps the standard roles but drops that accelerator.
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
 * the app running, and a second boot on reopen would start a second server on
 * the same database, whose startup marks every session exited. Only the
 * window is recreated. */
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
