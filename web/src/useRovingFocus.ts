import { useEffect, type RefObject } from "react";

// Arrow-key roving focus. Moves a visible focus ring across three columns —
// rail sessions, the center pane, and work cards (tickets/PRs). Up/Down within
// a column, Left/Right between columns; Enter activates (dives into the terminal
// for the center pane); Escape leaves a terminal/input back to the rail. Bails
// whenever focus is in a terminal or text field so typing is never hijacked.
//
// `navRef` remembers the last element the ring landed on, surviving re-renders.
export function useRovingFocus(navRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const typing = (el: Element | null) =>
      !!el &&
      (el.tagName === "INPUT" ||
        el.tagName === "TEXTAREA" ||
        (el as HTMLElement).isContentEditable ||
        !!el.closest(".xterm"));
    const NAV_SEL = ".rail .session, [data-nav-center], .work-col .pr-card";
    const q = (sel: string) =>
      Array.from(document.querySelectorAll<HTMLElement>(sel));
    const columns = () =>
      [
        { key: "rail", items: q(".rail .session") },
        { key: "center", items: q("[data-nav-center]") },
        { key: "work", items: q(".work-col .pr-card") },
      ].filter((c) => c.items.length > 0);
    // Move both real focus and an explicit ring class (a scripted .focus() can't
    // be relied on to trigger :focus-visible, so we mark the ring ourselves).
    const clearRing = () =>
      document
        .querySelectorAll(".roving-focus")
        .forEach((n) => n.classList.remove("roving-focus"));
    const focus = (el?: HTMLElement | null) => {
      if (!el) return;
      clearRing();
      el.classList.add("roving-focus");
      el.focus();
      navRef.current = el;
    };
    // A mouse interaction ends keyboard navigation — drop the ring.
    const onDown = () => clearRing();

    const onKey = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      // Escape steps out of a terminal/input back to the rail.
      if (e.key === "Escape" && typing(active)) {
        const rail =
          document.querySelector<HTMLElement>(".rail .session.active") ??
          document.querySelector<HTMLElement>(".rail .session");
        if (rail) {
          e.preventDefault();
          (active as HTMLElement)?.blur?.();
          focus(rail);
        }
        return;
      }
      if (typing(active)) return; // terminal/inputs own their keys
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const isArrow = e.key.startsWith("Arrow");
      if (!isArrow && e.key !== "Enter") return;

      const cols = columns();
      if (!cols.length) return;

      const cur =
        active && active.matches?.(NAV_SEL)
          ? active
          : navRef.current && document.contains(navRef.current)
            ? navRef.current
            : null;
      const ci = cur ? cols.findIndex((c) => c.items.includes(cur!)) : -1;
      const ii = ci >= 0 ? cols[ci].items.indexOf(cur!) : -1;

      if (e.key === "Enter") {
        if (!cur) return;
        e.preventDefault();
        if (cur.hasAttribute("data-nav-center"))
          (
            cur.querySelector<HTMLElement>(".xterm-helper-textarea") ?? cur
          ).focus();
        else cur.click();
        return;
      }

      e.preventDefault();
      // Not yet in the ring: enter at the active rail session (or first item).
      if (ci < 0) {
        const rail = cols.find((c) => c.key === "rail") ?? cols[0];
        focus(
          rail.items.find((el) => el.classList.contains("active")) ??
            rail.items[0],
        );
        return;
      }
      if (e.key === "ArrowUp") focus(cols[ci].items[Math.max(0, ii - 1)]);
      else if (e.key === "ArrowDown")
        focus(cols[ci].items[Math.min(cols[ci].items.length - 1, ii + 1)]);
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        const nci = Math.min(
          cols.length - 1,
          Math.max(0, ci + (e.key === "ArrowRight" ? 1 : -1)),
        );
        if (nci === ci) return;
        const dst = cols[nci];
        // Keep roughly the same vertical position when changing columns.
        const ratio =
          cols[ci].items.length > 1 ? ii / (cols[ci].items.length - 1) : 0;
        focus(
          dst.items[Math.round(ratio * (dst.items.length - 1))] ?? dst.items[0],
        );
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [navRef]);
}
