// The session colours, andria's palette (2026-10-29). The one copy: the server
// cycles through it when auto-assigning a colour to a new session, the web app
// renders it as the recolour swatch picker, and it's the colour of
// each kit's scarf.
export const COLORS = [
  "#67d0d5", // aqua
  "#84dba0", // mint
  "#fdcd4f", // canary yellow
  "#ffb077", // peachy orange
  "#f191cc", // classic pink
  "#b19de6", // lavender
  "#9cc5bf", // reef green
  "#9ce277", // leaf green
  "#c8e35a", // lime
  "#f5848c", // candy floss
  "#cd97da", // lilac
  "#6899f1", // sea blue
  "#9bade1", // no phase
];

/** The earlier palette's colours and their nearest in COLORS, so sessions
 * made before the change move over to it. */
export const RETIRED_COLORS: Record<string, string> = {
  "#ffb2d8": "#f191cc",
  "#ffcaa3": "#ffb077",
  "#f7e79c": "#fdcd4f",
  "#c9e9a0": "#c8e35a",
  "#a5e6c4": "#84dba0",
  "#a2dfe8": "#67d0d5",
  "#abc9f6": "#6899f1",
  "#bcb8f6": "#b19de6",
  "#d7b3f4": "#cd97da",
};
