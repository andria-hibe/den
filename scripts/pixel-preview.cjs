// Renders a pixel-art grid to a PNG so we can eyeball it. Run via electron.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

// Fox mascot — edit this grid freely.
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
  ".": "transparent",
  D: "#5b4b66",
  O: "#f2a25c",
  l: "#ffd19a",
  e: "#3a2e40",
  w: "#fff6fb",
  p: "#ff9ec4",
  P: "#ff9ec4",
};

function toSvg(grid, px) {
  const w = grid[0].length * px;
  const h = grid.length * px;
  let rects = "";
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const c = PALETTE[ch];
      if (!c || c === "transparent") return;
      rects += `<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="${c}"/>`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges">${rects}</svg>`;
}

app.whenReady().then(async () => {
  const big = toSvg(GRID, 22);
  const mid = toSvg(GRID, 10);
  const small = toSvg(GRID, 5);
  const win = new BrowserWindow({ width: 720, height: 460, show: false });
  const html = `<!doctype html><meta charset=utf8><style>
    body{margin:0;display:flex;gap:44px;align-items:center;justify-content:center;
      height:460px;background:#fdf6fb}
  </style>
  <div>${big}</div><div>${mid}</div><div>${small}</div>`;
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, "..", "build", "pixel-preview.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log("PREVIEW_WRITTEN " + out);
  app.quit();
});
