// Full-body pixel-art fox, designed to grow into multiple poses (sit, and later
// walk/jump/sleep) that represent app state. Each pose is a grid of color keys;
// all share one palette. Verified visually via scripts/pixel-preview.cjs.

export const FOX_PALETTE: Record<string, string> = {
  D: "#5b4b66", // outline
  O: "#f2a25c", // fox orange
  o: "#e08945", // darker orange (shading)
  w: "#fff6fb", // cream / belly / tail tip
  e: "#3a2e40", // eye
  p: "#ff9ec4", // pink nose / inner ear
};

// Sitting, front 3/4, fluffy tail curled to the right. The idle / default pose.
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

export type FoxPose = "sit";

export const FOX_SPRITES: Record<FoxPose, string[]> = {
  sit: SIT,
};
