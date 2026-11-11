// Snoozed PRs: hidden from the work panel until a time, and listed at the
// end of Fox's digest as put off. Kept in the settings table so the server
// knows too.
import { store } from "./store.ts";

const KEY = "snoozedPrs";
/** "owner/repo#123", the same key the client's prKey makes. */
const PR_KEY = /^[\w.-]+\/[\w.-]+#\d+$/;
const MAX_SNOOZE_MS = 31 * 24 * 60 * 60 * 1000;

/** PR key -> when its snooze ends (epoch ms), ended ones left out. */
export function listSnoozes(now = Date.now()): Record<string, number> {
  try {
    const all = JSON.parse(store.getSetting(KEY) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(all).filter((e): e is [string, number] => PR_KEY.test(e[0]) && typeof e[1] === "number" && e[1] > now),
    );
  } catch {
    return {};
  }
}

/** Snooze `key` until `until`, or wake it with null. False for a bad key or time. */
export function setSnooze(key: unknown, until: unknown, now = Date.now()): boolean {
  if (typeof key !== "string" || !PR_KEY.test(key)) return false;
  if (until !== null && (typeof until !== "number" || until <= now || until > now + MAX_SNOOZE_MS)) return false;
  const next = listSnoozes(now);
  if (until === null) delete next[key];
  else next[key] = until;
  store.setSetting(KEY, JSON.stringify(next));
  return true;
}
