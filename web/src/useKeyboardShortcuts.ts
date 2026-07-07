import { useEffect, useRef } from "react";
import type { SessionMeta } from "../../server/sessions.ts";

// Global keyboard shortcuts:
//   Cmd/Ctrl+N new claude · Cmd/Ctrl+T new shell ·
//   Cmd/Ctrl+1–9 switch to the Nth rail session · Cmd/Ctrl+W close the active.
// Handlers/state change between renders, so we read them through a ref and
// subscribe the listener once. (In the packaged app main.ts frees Cmd+W from
// the native menu; in the dev browser Cmd+W still closes the tab.)
export interface ShortcutState {
  rail: SessionMeta[];
  activeId: string | null;
  /** Suppress shortcuts while a modal / inline rename is open. */
  blocked: boolean;
  onNewClaude: () => void;
  onNewShell: () => void;
  onClose: (id: string) => void;
  onSelect: (id: string) => void;
}

export function useKeyboardShortcuts(state: ShortcutState) {
  const ref = useRef(state);
  ref.current = state;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      const s = ref.current;
      if (s.blocked) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        s.onNewClaude();
      } else if (k === "t") {
        e.preventDefault();
        s.onNewShell();
      } else if (k === "w") {
        if (!s.activeId) return;
        e.preventDefault();
        s.onClose(s.activeId);
      } else if (k >= "1" && k <= "9") {
        const target = s.rail[Number(k) - 1];
        if (target) {
          e.preventDefault();
          s.onSelect(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
