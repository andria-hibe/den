import { useEffect, useLayoutEffect, useRef, useState } from "react";

const DELAY_MS = 400;
const GAP = 6;

/** One hover tip for the whole app, showing any element's `title`, since
 * den's window never shows the native tooltip. The title is moved aside while
 * the tip is up, so a browser that does show native tooltips doesn't show two. */
export function HoverTip() {
  const [tip, setTip] = useState<{ text: string; x: number; top?: number; bottom?: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // Clamp to the window by the tip's real width, which follows its text.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !tip) return;
    const over = tip.x + el.offsetWidth + GAP - window.innerWidth;
    el.style.left = `${Math.max(GAP, tip.x - Math.max(0, over))}px`;
  }, [tip]);

  useEffect(() => {
    let el: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const restore = () => {
      clearTimeout(timer);
      if (el?.dataset.denTitle !== undefined) {
        // A re-render may have set a newer title meanwhile; keep that one.
        if (!el.hasAttribute("title")) el.setAttribute("title", el.dataset.denTitle);
        delete el.dataset.denTitle;
      }
      el = null;
      setTip(null);
    };

    const over = (e: MouseEvent) => {
      const target = (e.target as Element | null)?.closest<HTMLElement>("[title], [data-den-title]");
      if (target === el) return;
      restore();
      const text = target?.getAttribute("title");
      if (!target || !text) return;
      el = target;
      el.dataset.denTitle = text;
      el.removeAttribute("title");
      timer = setTimeout(() => {
        const r = target.getBoundingClientRect();
        const x = Math.max(GAP, r.left);
        // Below the element, or above it in the lower part of the window.
        setTip(
          r.bottom > window.innerHeight * 0.7
            ? { text, x, bottom: window.innerHeight - r.top + GAP }
            : { text, x, top: r.bottom + GAP },
        );
      }, DELAY_MS);
    };

    document.addEventListener("mouseover", over);
    document.addEventListener("mousedown", restore);
    window.addEventListener("blur", restore);
    return () => {
      restore();
      document.removeEventListener("mouseover", over);
      document.removeEventListener("mousedown", restore);
      window.removeEventListener("blur", restore);
    };
  }, []);

  if (!tip) return null;
  return (
    <div ref={box} className="attn-tip hover-tip" style={{ left: tip.x, top: tip.top, bottom: tip.bottom }} role="tooltip">
      {tip.text}
    </div>
  );
}
