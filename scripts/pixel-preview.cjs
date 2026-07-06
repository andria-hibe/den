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
  p: "#ff9ec4", // pink nose / inner ear / blush
  z: "#b9a7c9", // sleepy z
  s: "#ffe08a", // sparkle
  x: "#ff8fb0", // alert mark
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

// Sleeping: eyes closed (single line), little "z z z" drifting up-right.
const SLEEP = [
  "...DD.......DD.zzz",
  "..DOOD.....DOOD.z.",
  "..DOpOD...DOpODzz.",
  "..DOOOODDDOOOOD...",
  "..DOOOOOOOOOOOD...",
  "..DOOOOOOOOOOOD...",
  ".DOOOOOOOOOOOOD...",
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

// Happy: squinty ^^ eyes, sparkles, rosy cheeks.
const HAPPY = [
  "s..DD.......DD...s",
  "..DOOD.....DOOD...",
  "..DOpOD...DOpOD..s",
  "..DOOOODDDOOOOD...",
  "..DOOOOOOOOOOOD...",
  ".DOOeOOOOOOeOOD...",
  ".DOeOeOOOOeOeOD...",
  ".DOOOOOOOOOOOOD...",
  ".DOpwwwppwwwpOD...",
  ".DOOwwwwwwwwOOD...",
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

// Alert: a pink "!" popping up at the top-right; attentive eyes.
const ALERT = [
  "...DD.......DD.xx.",
  "..DOOD.....DOODxx.",
  "..DOpOD...DOpOD...",
  "..DOOOODDDOOOODx..",
  "..DOOOOOOOOOOOD...",
  "..DOOOOOOOOOOOD...",
  ".DOOeeOOOOeeOOD...",
  ".DOOeeOOOOeeOOD...",
  ".DOOOOOOOOOOOOD...",
  ".DOOwwwoowwwOOD...",
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

// Side view, facing right, for the walk cycle. Fluffy tail left, snout right.
const WALK1 = [
  "......DD.DD......",
  "..DD.DOODOOD.....",
  ".DooDDOOOOOOD....",
  ".DoowDOOOeOOODD..",
  "DooowOOOOOOOOOOp.",
  "DoowOOOOOOOOOOOD.",
  ".DDDOwwwwwwwwOOD.",
  "...DOwwwwwwwwwOD.",
  "...DOODOOODOOOD..",
  "...DD.DOD.DOD.D..",
  ".....DD...DD.....",
];

const WALK2 = [
  "......DD.DD......",
  "..DD.DOODOOD.....",
  ".DooDDOOOOOOD....",
  ".DoowDOOOeOOODD..",
  "DooowOOOOOOOOOOp.",
  "DoowOOOOOOOOOOOD.",
  ".DDDOwwwwwwwwOOD.",
  "...DOwwwwwwwwwOD.",
  "...DOODOOODOOOD..",
  "....DODD.DODD.D..",
  "....DD.....DD....",
];

const SPRITES = [
  { name: "sit", grid: SIT },
  { name: "walk1", grid: WALK1 },
  { name: "walk2", grid: WALK2 },
];

app.whenReady().then(async () => {
  const cells = SPRITES.map(
    (s) =>
      `<div style="display:flex;flex-direction:column;align-items:center;gap:10px">
        <div>${toSvg(s.grid, 13)}</div>
        <div>${toSvg(s.grid, 5)}</div>
        <div style="font:14px sans-serif;color:#5b4b66">${s.name}</div>
      </div>`,
  ).join("");
  const win = new BrowserWindow({ width: 960, height: 420, show: false });
  const html = `<!doctype html><meta charset=utf8><body style="margin:0;display:flex;gap:28px;align-items:center;justify-content:center;height:420px;background:#fdf6fb">${cells}</body>`;
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, "..", "build", "pixel-preview.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log("PREVIEW_WRITTEN " + out);
  app.quit();
});
