// den ships as two apps from one codebase: Den, and Burrow (den v2, with the
// Manager pane). Each keeps its own data so both can be installed side by side.

export type Edition = "den" | "burrow";

export const EDITION_NAME: Record<Edition, string> = { den: "den", burrow: "burrow" };
