import { useRef } from "react";
import { useTerminal } from "./useTerminal.ts";
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
  useTerminal(hostRef, session.id, onExit, onTitle);
  return (
    <div className="term-host-wrap">
      <div className="term-host" ref={hostRef} />
    </div>
  );
}
