import { useEffect, useState } from "react";

// localStorage-backed state hooks, shared by pane sizes, remembered tabs, and
// the dismissed-PR-attention map. (They grew up inside Splitter.tsx because
// pane sizes were the first user; they're independent of it.)

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

/**
 * A string (union) that persists to localStorage — used to remember which tab a
 * view was on. `allowed` guards against a stale value from an older build.
 */
export function usePersistentString<T extends string>(
  key: string,
  initial: T,
  allowed: readonly T[],
) {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key) as T | null;
    return stored && allowed.includes(stored) ? stored : initial;
  });
  useEffect(() => {
    localStorage.setItem(key, value);
  }, [key, value]);
  return [value, setValue] as const;
}

/**
 * A JSON-serialisable value that persists to localStorage. Used for the set of
 * PR attention flags you've dismissed (a `{ key: updatedAt }` map). A malformed
 * or stale stored value falls back to `initial`. The setter is `useState`'s, so
 * it's stable across renders (safe as an effect/callback dependency).
 */
export function usePersistentJson<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored === null ? initial : (JSON.parse(stored) as T);
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}
