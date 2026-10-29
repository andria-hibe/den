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
  Q: "#a8836b", // hedgehog quills
  q: "#7f6252",
  F: "#f7dcc4", // hedgehog face
  S: "#c26e43", // squirrel
  s: "#94532f",
  L: "#bba6e6", // owl
  l: "#9784c8",
  y: "#ffd27a", // owl beak and feet
};

export type CritterKind = "tanuki" | "raccoon" | "hedgehog" | "squirrel" | "owl";

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
    "..................",
    ".....D.D..D.D.....",
    "...D.DQDDDDQD.D...",
    "...DQQQqQQqQQQD...",
    "..DQqQQQQQQQQqQD..",
    ".DQQQQFFFFFFQQQQD.",
    ".DQqQFFFFFFFFQqQD.",
    "DQQQFFeFFFFeFFQQQD",
    "DQqQFFeFFFFeFFQqQD",
    "DQQQFpFFFFFFpFQQQD",
    ".DQQFFFFDDFFFFQQD.",
    ".DQqQFFFFFFFFQqQD.",
    "..DQQFFFFFFFFQQD..",
    "..DQqFFFFFFFFqQD..",
    "..DQQFFFFFFFFQQD..",
    "...DQQFFFFFFQQD...",
    "....DQQQQQQQQD....",
    "....DFFD..DFFD....",
    "....DDDD..DDDD....",
  ],
  squirrel: [
    "..D...D....DDDD...",
    ".DSD.DSD..DSSSSD..",
    ".DSSDSSD.DSSssSSD.",
    ".DSSSSSSDDSsDDsSD.",
    ".DSSSSSSSDSsD.DsD.",
    "DSSeSSSeSSDsSD.D..",
    "DSSeSSSeSSDssSD...",
    "DSwwSpSwwSDSsSD...",
    ".DwwwwwwwD.DSSD...",
    "..DSSSSSD..DSsD...",
    ".DSSwwwSSD.DSSD...",
    ".DSwwwwwSSDDSsD...",
    "DSSwwwwwwSSDSSD...",
    "DSwwwwwwwwSSsSD...",
    "DSwwwwwwwwSsSD....",
    "DSSwwwwwwSSSD.....",
    ".DSSSSSSSSSD......",
    ".DSsSD.DSsSD......",
    ".DDDD..DDDD.......",
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
  { kind: "tanuki", name: "Tanuki", job: "Sweeps your Linear inbox and GitHub notifications", model: "Sonnet", built: false },
  { kind: "raccoon", name: "Raccoon", job: "Digs through failing CI and spots the same failure on other PRs", model: "Haiku", built: false },
  { kind: "hedgehog", name: "Hedgehog", job: "Tucks sessions in at clock out by refreshing each handover", model: "each session's own", built: false },
  { kind: "squirrel", name: "Squirrel", job: "Rations the week's tokens: the pace chip in the top bar", model: "no model, den's own code", built: true },
  { kind: "owl", name: "Owl", job: "Called in for the hardest problems, only with your OK", model: "Fable", built: false },
];
