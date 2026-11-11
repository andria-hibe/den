// Everything den types into a Claude session is ASCII, and so is everything it
// asks a session to write back where the developer copies it into GitHub. An
// em dash or a curly quote survives a paste as mojibake in some boxes and breaks
// a code span in others, and a prompt full of them teaches the model to write
// them back.
//
// Shared so the server's instructions and the client's paste prompts are held
// to one check.

/** True if `s` is pure 7-bit ASCII (tab and newline allowed). */
export function isAscii(s: string): boolean {
  return !/[^\t\n\x20-\x7e]/.test(s);
}

const ASCII_FOR: Record<string, string> = {
  "\u2018": "'", "\u2019": "'", "\u201a": "'", "\u201b": "'",
  "\u201c": '"', "\u201d": '"', "\u201e": '"',
  "\u2013": "-", "\u2014": "-", "\u2212": "-",
  "\u2026": "...", "\u2192": "->", "\u2190": "<-", "\u00a0": " ", "\u2022": "-",
};

/** `s` with the usual typographic characters (curly quotes, dashes, ellipses,
 * arrows) swapped for ASCII, and whatever else is still not ASCII. */
export function toAscii(s: string): { text: string; left: string[] } {
  const text = s
    .replace(/\r\n?/g, "\n")
    .replace(/[\u2018-\u201e\u2013\u2014\u2212\u2026\u2190\u2192\u00a0\u2022]/g, (c) => ASCII_FOR[c] ?? c);
  return { text, left: [...new Set(text.match(/[^\t\n\x20-\x7e]/gu) ?? [])] };
}
