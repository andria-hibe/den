import { useEffect, useRef, useState } from "react";

/** A number that persists to localStorage (used for pane sizes). */
export function usePersistentNumber(key: string, initial: number) {
  const [value, setValue] = useState<number>(() => {
    const stored = localStorage.getItem(key);
    const n = stored === null ? NaN : Number(stored);
    return Number.isFinite(n) ? n : initial;
  });
  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);
  return [value, setValue] as const;
}

export const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/**
 * A draggable divider. `dir="x"` is a vertical bar you drag horizontally;
 * `dir="y"` is a horizontal bar you drag vertically. `onDrag` receives the
 * incremental movement in px since the last event.
 */
export function Splitter({
  dir,
  onDrag,
}: {
  dir: "x" | "y";
  onDrag: (deltaPx: number) => void;
}) {
  const last = useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    last.current = dir === "x" ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const cur = dir === "x" ? ev.clientX : ev.clientY;
      onDrag(cur - last.current);
      last.current = cur;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    document.body.style.userSelect = "none";
    document.body.style.cursor = dir === "x" ? "col-resize" : "row-resize";
  };

  return (
    <div
      className={`splitter splitter-${dir}`}
      onPointerDown={onPointerDown}
      role="separator"
      aria-orientation={dir === "x" ? "vertical" : "horizontal"}
    />
  );
}
