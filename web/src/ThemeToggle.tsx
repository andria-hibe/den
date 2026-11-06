import { useSyncExternalStore } from "react";
import type { ThemeName } from "./termThemes.ts";

const KEY = "den.theme";

/** The theme picked with the toggle, if any; the system's otherwise. */
function savedTheme(): ThemeName | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

const systemTheme = (): ThemeName =>
  window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";

/** Apply the saved theme before the first render, so the page doesn't flash
 * the system's. theme.css keys off `data-theme` on the root. */
export function applySavedTheme(): void {
  const t = savedTheme();
  if (t) document.documentElement.dataset.theme = t;
}

function currentTheme(): ThemeName {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : systemTheme();
}

function subscribe(onChange: () => void): () => void {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener("change", onChange);
  return () => {
    mo.disconnect();
    mq?.removeEventListener("change", onChange);
  };
}

/** The theme den is showing: the toggle's pick, or the system's until one is made. */
export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribe, currentTheme);
}

/** The topbar's light / dark switch. A pick sticks across restarts; until
 * then den follows the system. */
export function ThemeToggle() {
  const theme = useTheme();
  const next: ThemeName = theme === "dark" ? "light" : "dark";
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
      }}
    >
      {/* Text presentation, so the glyphs match the day buttons beside it. */}
      {theme === "dark" ? "☾︎" : "☀︎"}
    </button>
  );
}
