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
