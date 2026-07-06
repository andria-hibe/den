// Renders one or more pixel-art grids side by side (with labels) for visual QA.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const PALETTE = {
  ".": "transparent",
  D: "#5b4b66", // outline
  O: "#f2a25c", // fox orange
  o: "#e08945", // darker orange (shading)
  w: "#fff6fb", // cream / belly / tail tip
  e: "#3a2e40", // eye
  p: "#ff9ec4", // pink nose / inner ear
};

// --- SPRITES ---------------------------------------------------------------
// Sitting fox, front 3/4, tail curled to the right.
const SIT = [
  "...DD.......DD....",
  "..DOOD.....DOOD...",
  "..DOpOD...DOpOD...",
  "..DOOOODDDOOOOD...",
  "..DOOOOOOOOOOOD...",
  "..DOOOOOOOOOOOD...",
  ".DOOeeOOOOeeOOD...",
  ".DOOeeOOOOeeOOD...",
  ".DOOOOOOOOOOOOD...",
  ".DOOwwwppwwwOOD...",
  "..DOOwwwwwwOOD.DD.",
  "..DOOOOOOOOOD.DooD",
  ".DOOwwwwwwwwOODooD",
  ".DOwwwwwwwwwwODowD",
  ".DOwwwwwwwwwwODwwD",
  ".DOOwwwwwwwwOODwD.",
  "..DOOOOOOOOOOODD..",
  "..DOwOD...DOwOD...",
  "..DDDD....DDDD....",
];

function pad(grid) {
  const w = Math.max(...grid.map((r) => r.length));
  return grid.map((r) => r.padEnd(w, "."));
}

function toSvg(grid, px) {
  const g = pad(grid);
  const w = g[0].length * px;
  const h = g.length * px;
  let rects = "";
  g.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const c = PALETTE[ch];
      if (c && c !== "transparent")
        rects += `<rect x="${x * px}" y="${y * px}" width="${px}" height="${px}" fill="${c}"/>`;
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges">${rects}</svg>`;
}

const SPRITES = [{ name: "sit", grid: SIT }];

app.whenReady().then(async () => {
  const cells = SPRITES.map(
    (s) =>
      `<div style="display:flex;flex-direction:column;align-items:center;gap:10px">
        <div>${toSvg(s.grid, 18)}</div>
        <div>${toSvg(s.grid, 7)}</div>
        <div style="font:14px sans-serif;color:#5b4b66">${s.name}</div>
      </div>`,
  ).join("");
  const win = new BrowserWindow({ width: 900, height: 560, show: false });
  const html = `<!doctype html><meta charset=utf8><body style="margin:0;display:flex;gap:40px;align-items:center;justify-content:center;height:560px;background:#fdf6fb">${cells}</body>`;
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, "..", "build", "pixel-preview.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log("PREVIEW_WRITTEN " + out);
  app.quit();
});
