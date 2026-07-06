// Full-body pixel-art fox with multiple poses that represent app state.
// Front-view emotes (sit/sleep/happy/alert) share one body; a side-view walk
// cycle is used for busy/loading. Verified visually via scripts/pixel-preview.cjs.

export const FOX_PALETTE: Record<string, string> = {
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

// Sitting, front 3/4, fluffy tail curled to the right. Idle / default.
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

// Sleeping: eyes closed (single line). The drifting "z"s are overlaid + animated
// in the UI (see .zzz in the empty state), not baked into the sprite.
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

// Happy: squinty ^^ eyes, sparkles.
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

// Alert: a bold "!" popping up at the top-right.
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

// Side view, facing right, for the walk cycle (busy / loading). The big
// upswept white-tipped tail + pointy snout are the fox tells. Two frames.
const WALK1 = [
  "..DwD........DD...",
  ".DwwoD......DOOD..",
  ".DwoooD....DOOOOD.",
  "DwooooD...DOOeOOOD",
  "DwooooD..DOOOOOOOD",
  "DoooooD.DOOOOOOOOp",
  ".DooooOOOOOOOOOOOD",
  ".DDooOwwwwwwwwwOOD",
  "...DOwwwwwwwwwwOD.",
  "...DOODOOODOOOD...",
  "...DOD.DOOD.DOD...",
  "...DD....DD...DD..",
];

const WALK2 = [
  "..DwD........DD...",
  ".DwwoD......DOOD..",
  ".DwoooD....DOOOOD.",
  "DwooooD...DOOeOOOD",
  "DwooooD..DOOOOOOOD",
  "DoooooD.DOOOOOOOOp",
  ".DooooOOOOOOOOOOOD",
  ".DDooOwwwwwwwwwOOD",
  "...DOwwwwwwwwwwOD.",
  "...DOODOOODOOOD...",
  "..DODD.DOOD.DDOD..",
  "..DD.....DD....DD.",
];

export type FoxPose = "sit" | "sleep" | "happy" | "alert" | "walk";

// Each pose is a list of animation frames (most are a single frame).
export const FOX_FRAMES: Record<FoxPose, string[][]> = {
  sit: [SIT],
  sleep: [SLEEP],
  happy: [HAPPY],
  alert: [ALERT],
  walk: [WALK1, WALK2],
};
