import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "den.theme";

/** The theme picked with the toggle, if any; the system's otherwise. */
function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

const systemTheme = (): Theme => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");

/** Apply the saved theme before the first render, so the page doesn't flash
 * the system's. theme.css keys off `data-theme` on the root. */
export function applySavedTheme(): void {
  const t = savedTheme();
  if (t) document.documentElement.dataset.theme = t;
}

/** The topbar's light / dark switch. A pick sticks across restarts; until
 * then den follows the system. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => savedTheme() ?? systemTheme());
  // Follow the system while nothing has been picked.
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const follow = () => !savedTheme() && setTheme(systemTheme());
    mq.addEventListener("change", follow);
    return () => mq.removeEventListener("change", follow);
  }, []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      className="btn topbar-day theme-toggle"
      title={`Switch to ${next} mode`}
      aria-label={`Switch to ${next} mode`}
      onClick={() => {
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(KEY, next);
        } catch {
          // still switched for this window
        }
        setTheme(next);
      }}
    >
      {/* Text presentation, so the glyphs match the day buttons beside it. */}
      {theme === "dark" ? "\u263E\uFE0E" : "\u2600\uFE0E"}
    </button>
  );
}
