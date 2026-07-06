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
  x: "#ff5c7a", // alert mark (bold)
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
  "...DD.......DD....",
  "..DOOD.....DOOD...",
  "..DOpOD...DOpOD...",
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
  "...DD.......DD..xx",
  "..DOOD.....DOOD.xx",
  "..DOpOD...DOpOD.xx",
  "..DOOOODDDOOOOD...",
  "..DOOOOOOOOOOOD.xx",
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

// Side view, facing right. Big bushy white-tipped tail (left), pointy ear +
// snout (right) — the fox tells.
// Front-facing walk (busy): the sitting body with feet stepping apart/together.
const WALK1 = [
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
  ".DOwOD.....DOwOD..",
  ".DDDD......DDDD...",
];

const WALK2 = [
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
  "...DOwOD.DOwOD....",
  "...DDDD..DDDD.....",
];

const SPRITES = [
  { name: "sit (idle)", grid: SIT },
  { name: "alert", grid: ALERT },
  { name: "walk 1", grid: WALK1 },
  { name: "walk 2", grid: WALK2 },
];

app.whenReady().then(async () => {
  const cells = SPRITES.map(
    (s) =>
      `<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:12px">
        <div style="height:230px;display:flex;align-items:flex-end">${toSvg(s.grid, 11)}</div>
        <div style="font:600 15px ui-sans-serif,sans-serif;color:#5b4b66">${s.name}</div>
      </div>`,
  ).join("");
  const win = new BrowserWindow({ width: 1360, height: 360, show: false });
  const html = `<!doctype html><meta charset=utf8><body style="margin:0;display:flex;gap:24px;align-items:center;justify-content:center;height:360px;background:#fdf6fb">${cells}</body>`;
  await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, "..", "build", "pixel-preview.png");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log("PREVIEW_WRITTEN " + out);
  app.quit();
});
