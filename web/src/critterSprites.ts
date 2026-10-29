// Burrow's worker crew (#46): forest animals drawn to sit beside den's fox
// (foxSprites.ts SIT) at the same 18x19 size, outline, and eye colours.
// Verified visually with a scratch render, like scripts/pixel-preview.cjs.

export const CRITTER_PALETTE: Record<string, string> = {
  D: "#5b4b66", // outline (as the fox)
  e: "#3a2e40", // eye
  w: "#fff6fb", // cream
  p: "#ff9ec4", // pink
  k: "#6f6075", // tanuki and raccoon mask
  T: "#c49a74", // tanuki
  t: "#9c7457",
  R: "#b9b1c8", // raccoon
  r: "#8f86a0",
  Q: "#b48466", // hedgehog quills
  q: "#93664c",
  F: "#f6e7c4", // hedgehog face
  h: "#f0b48c", // hedgehog ears and feet
  M: "#cdb39c", // field mouse
  L: "#bba6e6", // owl
  l: "#9784c8",
  y: "#ffd27a", // owl beak and feet, wolf eyes
  O: "#f2a25c", // kit (the fox's orange)
  G: "#a49cb0", // badger
  g: "#7d7489",
  K: "#4a4152", // badger stripes
  A: "#a98468", // hare
  a: "#86654f",
  W: "#9ea3ba", // wolf
  V: "#757a93",
  X: "#ffb7d5", // kit's scarf: the session's colour in the app (Critter tint)
  Y: "#c5809f", // the scarf's shaded lower row, so it stands off the orange fur
};

export type CritterKind = "tanuki" | "raccoon" | "hedgehog" | "mouse" | "owl" | "badger" | "hare" | "wolf" | "kit";

export const CRITTERS: Record<CritterKind, string[]> = {
  tanuki: [
    "..................",
    "..DDD.......DDD...",
    ".DTkTD.....DTkTD..",
    ".DTTTTDDDDDTTTTD..",
    "..DTTTTTTTTTTTD...",
    ".DTTTTTTTTTTTTTD..",
    ".DTkkkTTTTTkkkTD..",
    ".DkkekkTTTkkekkD..",
    ".DkkekTwwwTkekkD..",
    "..DTkTwwDwwTkTD...",
    "..DTTTwwwwwTTTD.DD",
    "..DTTTTTTTTTTD.DTD",
    ".DTTwwwwwwwwTTDTTD",
    ".DTwwwwwwwwwwTDtTD",
    ".DTwwwwwwwwwwTDkkD",
    ".DTTwwwwwwwwTTDkD.",
    "..DTTTTTTTTTTTDD..",
    "..DTkTD...DTkTD...",
    "..DDDD....DDDD....",
  ],
  raccoon: [
    "...DD.......DD....",
    "..DwRD.....DRwD...",
    "..DRRRD...DRRRD...",
    "..DRRRRDDDRRRRD...",
    "..DRwwwRRRwwwRD...",
    ".DkkkkkkRkkkkkkD..",
    ".DkkekkkRkkkekkD..",
    ".DRkekRwwwRkekRD..",
    "..DRRwwwwwwwRRD...",
    "..DRRwwwDwwwRRD...",
    "...DRRwwwwwRRD.DD.",
    "..DRRRRRRRRRRD.DRD",
    ".DRRwwwwwwwwRRDkkD",
    ".DRwwwwwwwwwwRDRRD",
    ".DRwwwwwwwwwwRDkkD",
    ".DRRwwwwwwwwRRDRD.",
    "..DRRRRRRRRRRRDD..",
    "..DRrRD...DRrRD...",
    "..DDDD....DDDD....",
  ],
  hedgehog: [
    "....D...D...D.....",
    "...DQD.DQD.DQD....",
    "..DQQQDQQQDQQQD...",
    ".DQQqQQQQqQQQqQDD.",
    ".DQQQQQQQQQQQQQQQD",
    "DQQqQQQQQQQQqQQQD.",
    "DQQQQQqQQQQQQQQQQD",
    "DhQQQQQFQQQQFQQQD.",
    "DhhQFFFFFQFFFFhhQD",
    "DhFFFFFFFFFFFFFQD.",
    "DFFFeeFFFFFFeeFQQD",
    "DFFFeeFFppFFeeFQD.",
    "DFppFFFDFFDFFppQQD",
    "DFFFFFFFDDFFFFFQD.",
    ".DFFFFFFFFFFFFFQQD",
    ".DQFFFFFFFFFFFQQD.",
    "..DQQFFFFFFFFQQD..",
    "..DhhDDDDDDDDhhD..",
    "...DD........DD...",
  ],
  mouse: [
    ".DDDD.....DDDD....",
    "DMMMMD...DMMMMD...",
    "DMppMMDDDMMppMD...",
    "DMppMMMMMMMppMD...",
    ".DMMMMMMMMMMMD....",
    "..DMMMMMMMMMD.....",
    ".DMMeMMMMMeMMD....",
    ".DMMeMMMMMeMMD....",
    ".DMMMMMMMMMMMD....",
    "..DMwwwpwwwMD.....",
    "...DMwwwwwMD......",
    "...DMMMMMMMD......",
    "..DMMwwwwwMMD.....",
    ".DMwwwwwwwwwMD....",
    ".DMwwwwwwwwwMD...D",
    ".DMMwwwwwwwMMD..Dp",
    "..DMMMMMMMMMDDDDp.",
    "..DMpMD.DMpMDpppD.",
    "..DDDD..DDDD.DDD..",
  ],
  owl: [
    "..DD........DD....",
    "..DLD......DLD....",
    "..DLLDDDDDDLLD....",
    ".DLLLLLLLLLLLLD...",
    ".DLwwwwLLwwwwLD...",
    "DLwwwwwwwwwwwwLD..",
    "DLwweewwwweewwLD..",
    "DLwweewwwweewwLD..",
    "DLLwwwwyywwwwLLD..",
    ".DLLLLLyyLLLLLD...",
    ".DlLLLLLLLLLLlD...",
    "DllLwwwwwwwwLllD..",
    "DllLwwwwwwwwLllD..",
    "DllLwwwwwwwwLllD..",
    "DllLLwwwwwwLLllD..",
    ".DlLLLLLLLLLLlD...",
    "..DLLLLLLLLLLD....",
    "...DyyD..DyyD.....",
    "...DDDD..DDDD.....",
  ],
  badger: [
    "..................",
    "..DD.........DD...",
    ".DwKD.......DKwD..",
    ".DKKKDDDDDDDKKKD..",
    "..DwKKKwwwKKKwD...",
    ".DwwKKKwwwKKKwwD..",
    ".DwwKKKwwwKKKwwD..",
    ".DwwKwKwwwKwKwwD..",
    ".DwwKKKwwwKKKwwD..",
    ".DwwwKKwwwKKwwwD..",
    "..DwwwKwwwKwwwD...",
    "..DwwwwwKwwwwwD...",
    ".DGGGGGGGGGGGGGD..",
    ".DGgGGGGGGGGGgGD..",
    "DGGGgGGGGGGGgGGGD.",
    "DGGGGGGGGGGGGGGGD.",
    ".DGGGGGGGGGGGGGD..",
    ".DKKKD.....DKKKD..",
    ".DDDDD.....DDDDD..",
  ],
  hare: [
    "..DD.......DD.....",
    ".DAAD.....DAAD....",
    ".DApD.....DApD....",
    ".DApD.....DApD....",
    ".DApAD...DApAD....",
    "..DAADDDDDAAD.....",
    "..DAAAAAAAAAD.....",
    ".DAAAAAAAAAAAD....",
    ".DAAeeAAAAeeAD....",
    ".DAAeeAAAAeeAD....",
    ".DAAAAwwwwAAAD....",
    "..DAwwwpwwwAD.....",
    "...DAwwwwwAD......",
    "..DAAAAAAAAAD.....",
    ".DAAwwwwwwwAAD.DD.",
    ".DAwwwwwwwwwADDwwD",
    ".DAAwwwwwwwAADwwwD",
    "..DAaAD.DAaADDDDD.",
    "..DDDD..DDDD......",
  ],
  wolf: [
    "..DD.........DD...",
    "..DWD.......DWD...",
    "..DWVD.....DVWD...",
    "..DWWWDDDDDWWWD...",
    "..DWWWWVVVWWWWD...",
    ".DWWWWWWVWWWWWWD..",
    ".DWWyyWWWWWyyWWD..",
    ".DWWeeWWWWWeeWWD..",
    "DWWWWWwwwwwWWWWWD.",
    "DwWWWwwwDwwwWWWwD.",
    ".DwDWwwwwwwwWDwD..",
    "..DWWWwwwwWWWD.DD.",
    ".DWWwwwwwwwwWWDWWD",
    ".DWwwwwwwwwwwWDWWD",
    ".DWwwwwwwwwwwWDWVD",
    ".DWWwwwwwwwwWWDVD.",
    "..DWWWWWWWWWWWDD..",
    "..DWVWD...DWVWD...",
    "..DDDD....DDDD....",
  ],
  kit: [
    "..................",
    "..................",
    "..................",
    "...DD.......DD....",
    "..DOOD.....DOOD...",
    "..DOpODDDDDOpOD...",
    "..DOOOOOOOOOOOD...",
    ".DOOOOOOOOOOOOOD..",
    ".DOOeeOOOOOeeOOD..",
    ".DOOeeOOOOOeeOOD..",
    ".DOpOwwwpwwwOpOD..",
    "..DOOwwwwwwwOOD...",
    "..DXXXXXXXXXXXD...",
    "..DYYYYYYYYYYYD...",
    "...DOwXYwwwwOD.DD.",
    "...DOwXYwwwwOD.DOD",
    "...DOOOOOOOOODDOwD",
    "...DOwOD.DOwODDwD.",
    "...DDDD..DDDD..D..",
  ],
};

export interface CrewMember {
  kind: "fox" | CritterKind;
  name: string;
  job: string;
  model: string;
  /** False until the worker exists; the crew strip shows it resting. */
  built: boolean;
}

/** The Manager and its workers, in the order the crew strip shows them. */
export const CREW: CrewMember[] = [
  { kind: "fox", name: "Fox", job: "Plans your day with you and passes your answers to sessions", model: "Opus", built: true },
  { kind: "tanuki", name: "Tanuki", job: "Sweeps your Linear inbox and GitHub notifications", model: "Sonnet", built: true },
  { kind: "raccoon", name: "Raccoon", job: "Digs through failing CI and spots the same failure on other PRs", model: "Haiku", built: true },
  { kind: "hedgehog", name: "Hedgehog", job: "Tucks sessions in at clock out by refreshing each handover", model: "each session's own", built: true },
  { kind: "mouse", name: "Field mouse", job: "Rations the week's tokens: the pace chip in the top bar", model: "no model, den's own code", built: true },
  { kind: "badger", name: "Badger", job: "QA: runs the tests, checks the change in the browser with screenshots, and tries to break it", model: "Sonnet", built: true },
  { kind: "hare", name: "Hare", job: "Checks performance: slow queries, wasted renders, heavy loops, with a quick measurement where it can", model: "Sonnet", built: true },
  { kind: "wolf", name: "Wolf", job: "Checks security: auth gaps, leaked secrets, injection, using the repo's own security review", model: "Opus", built: true },
  { kind: "owl", name: "Owl", job: "Reviews code (colleagues' PRs, and a kit's own PR before you look) and advises kits and Fox on hard problems", model: "Opus, or Fable for the hardest when the week has room", built: true },
];
