// Renders a cute pastel app icon with Electron (Chromium draws the emoji
// crisply) and writes build/icon.png. Run via: electron scripts/make-icon.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SIZE = 1024;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    webPreferences: { offscreen: false },
  });

  const html = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent;overflow:hidden}
    .icon{
      width:${SIZE}px;height:${SIZE}px;box-sizing:border-box;
      display:flex;align-items:center;justify-content:center;
      background:linear-gradient(135deg,#ffc2de 0%,#cdb4f6 55%,#b4d8f6 100%);
      border-radius:${Math.round(SIZE * 0.225)}px;
      box-shadow:inset 0 -60px 120px rgba(255,255,255,.30), inset 0 40px 90px rgba(255,255,255,.35);
    }
    .fox{font-size:600px;line-height:1;filter:drop-shadow(0 24px 34px rgba(90,60,90,.35));}
  </style><div class="icon"><div class="fox">🦊</div></div>`;

  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, "..", "build", "icon.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log("ICON_WRITTEN " + out);
  app.quit();
});
