// Renders the den app icon (our pixel-art fox on a pastel gradient) with
// Electron so Chromium rasterises it crisply, and writes build/icon.png.
// Run via: npx electron scripts/make-icon.cjs  (then rebuild icon.icns).
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const SIZE = 1024;

// Keep this fox in sync with web/src/PixelFox.tsx.
const GRID = [
  "..DD........DD..",
  ".DOOD......DOOD.",
  ".DOpOD....DOpOD.",
  ".DOOOD....DOOOD.",
  ".DOOOOD..DOOOOD.",
  "DOOOOOOOOOOOOOOD",
  "DOOOOOOOOOOOOOOD",
  "DOOeeOOOOOOeeOOD",
  "DOOeeOOOOOOeeOOD",
  "DOOOOOOOOOOOOOOD",
  ".DOwwwwwwwwwwOD.",
  ".DOwwwwppwwwwOD.",
  "..DOwwwwwwwwOD..",
  "...DOwwwwwwOD...",
  "....DDOOOODD....",
];
const PALETTE = {
  D: "#5b4b66",
  O: "#f2a25c",
  p: "#ff9ec4",
  e: "#3a2e40",
  w: "#fff6fb",
};
const COLS = GRID[0].length;
const ROWS = GRID.length;

function foxSvg() {
  let rects = "";
  GRID.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = PALETTE[ch];
      // 1.02 overlap avoids hairline seams between rects when rasterised.
      if (fill) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${fill}"/>`;
    });
  });
  const w = Math.round(SIZE * 0.66); // fox spans ~66% of the icon width, centred
  const h = Math.round((w / COLS) * ROWS);
  return `<svg class="fox" width="${w}" height="${h}" viewBox="0 0 ${COLS} ${ROWS}"
      shape-rendering="crispEdges" style="image-rendering:pixelated">${rects}</svg>`;
}

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
    .fox{filter:drop-shadow(0 20px 28px rgba(90,60,90,.32));}
  </style><div class="icon">${foxSvg()}</div>`;

  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, "..", "build", "icon.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log("ICON_WRITTEN " + out);
  app.quit();
});
