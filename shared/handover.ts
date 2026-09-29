// The shape of a workspace notepad (#27): four sections for the developer,
// then session notes for the next session. Shared so the server's seed and
// instruction (sessions.ts), the client's ticket seed (prompts.ts), and
// NotepadPane all name the same headings.

export const HANDOVER_HEADINGS = [
  "Where it stands",
  "Done",
  "Next",
  "Waiting on you",
] as const;

/** The session-to-session handover, below the developer's sections. */
export const SESSION_NOTES_HEADING = "Session notes";

/** The empty handover a new notepad starts with. */
export const HANDOVER_TEMPLATE =
  "## Where it stands\n\nNot started yet.\n\n" +
  "## Done\n\n" +
  "## Next\n\n" +
  "## Waiting on you\n\nNothing.\n\n" +
  "---\n\n" +
  `## ${SESSION_NOTES_HEADING}\n\nNothing yet.\n`;

/** Is this notepad a handover (as opposed to an older running log)? */
export function isHandover(md: string): boolean {
  return md.includes(`## ${HANDOVER_HEADINGS[0]}`);
}
