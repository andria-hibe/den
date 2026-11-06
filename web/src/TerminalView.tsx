import { useRef } from "react";
import { useTerminal } from "./useTerminal.ts";
import { useTheme } from "./ThemeToggle.tsx";
import { TERM_THEMES } from "./termThemes.ts";
import type { SessionMeta } from "../../server/sessions.ts";

// One session's live terminal. The padding/background live on the wrapper, NOT
// on the element FitAddon measures (.term-host): FitAddon reads
// getComputedStyle(host).height, which with border-box includes padding, so
// padding here would make it fit one row too many and clip the last line.
export function TerminalView({
  session,
  onExit,
  onTitle,
}: {
  session: SessionMeta;
  onExit: () => void;
  onTitle: (name: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Claude keeps the theme it started with, so its pane keeps the matching
  // colours until it restarts; a shell follows den.
  const denTheme = useTheme();
  const theme = session.termTheme ?? denTheme;
  useTerminal(hostRef, session.id, onExit, onTitle, theme);
  return (
    <div className="term-host-wrap" style={{ background: TERM_THEMES[theme].background }}>
      <div className="term-host" ref={hostRef} />
    </div>
  );
}
