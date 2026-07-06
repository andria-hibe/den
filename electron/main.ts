import { app, BrowserWindow, shell } from "electron";
import { join } from "node:path";
import { startServer, type RunningServer } from "../server/app.ts";

// Bundled to dist/electron/main.cjs (esbuild), so __dirname is dist/electron.
let server: RunningServer | null = null;

async function boot() {
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
