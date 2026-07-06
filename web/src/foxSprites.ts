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
  x: "#ff8fb0", // alert mark
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

// Sleeping: eyes closed (single line), little "z" drifting up-right.
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

// Side view, facing right, for the walk cycle (busy / loading). Two frames.
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

export type FoxPose = "sit" | "sleep" | "happy" | "alert" | "walk";

// Each pose is a list of animation frames (most are a single frame).
export const FOX_FRAMES: Record<FoxPose, string[][]> = {
  sit: [SIT],
  sleep: [SLEEP],
  happy: [HAPPY],
  alert: [ALERT],
  walk: [WALK1, WALK2],
};
