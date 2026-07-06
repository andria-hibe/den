// Screenshots a URL for visual QA. Run: SHOT_URL=... electron scripts/shot.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    show: false,
    backgroundColor: "#fdf6fb",
  });
  await win.loadURL(process.env.SHOT_URL);
  await new Promise((r) => setTimeout(r, 1800));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, "..", "build", process.env.SHOT_OUT || "app-shot.png");
  fs.writeFileSync(out, img.toPNG());
  console.log("SHOT_WRITTEN " + out);
  app.quit();
});
