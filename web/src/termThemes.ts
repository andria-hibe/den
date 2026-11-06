import type { ITheme } from "@xterm/xterm";

export type ThemeName = "light" | "dark";

/** xterm colours for each den theme. Claude Code draws in its own truecolor
 * theme (den passes the matching one in --settings), so the ANSI colours
 * mostly reach shell output. */
export const TERM_THEMES: Record<ThemeName, ITheme> = {
  dark: {
    background: "#2b2233",
    foreground: "#f3e9f7",
    cursor: "#ffb7d5",
    selectionBackground: "#5b4b66",
    black: "#5b4b66",
    red: "#ff8fa8",
    green: "#8ee6b0",
    yellow: "#ffd28a",
    blue: "#8fc3f0",
    magenta: "#d7a7ff",
    cyan: "#9ce8d3",
    white: "#d9cfe0",
    brightBlack: "#a99bb4",
    brightRed: "#ffadc0",
    brightGreen: "#b0f0c8",
    brightYellow: "#ffe2b0",
    brightBlue: "#b4d8f6",
    brightMagenta: "#e6c8ff",
    brightCyan: "#c0f2e4",
    brightWhite: "#ffffff",
  },
  light: {
    background: "#fbf5fc",
    foreground: "#4a3a52",
    cursor: "#d9467f",
    cursorAccent: "#fbf5fc",
    selectionBackground: "#e6d3ef",
    black: "#4a3a52",
    red: "#c0305f",
    green: "#2e7a58",
    yellow: "#9a5612",
    blue: "#2f6fa8",
    magenta: "#8a3fc0",
    cyan: "#17766a",
    // Light-on-light would vanish, so the whites are mid and dark greys.
    white: "#8f7d9c",
    brightBlack: "#75628a",
    brightRed: "#a8284a",
    brightGreen: "#1f6b45",
    brightYellow: "#8a4c00",
    brightBlue: "#1d62a0",
    brightMagenta: "#7a3fb0",
    brightCyan: "#136b60",
    brightWhite: "#5b4b66",
  },
};
