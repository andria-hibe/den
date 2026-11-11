// The developer's own review prompts, offered beside "Full" and "Blockers
// only" when a review starts. Kept in the settings table as one JSON list.
import { randomUUID } from "node:crypto";
import { store } from "./store.ts";
import { toAscii } from "../shared/ascii.ts";

export interface SavedPrompt {
  id: string;
  name: string;
  text: string;
}

const KEY = "reviewPrompts";
const MAX_PROMPTS = 20;
const MAX_NAME = 40;
const MAX_TEXT = 2000;

export function listPrompts(): SavedPrompt[] {
  try {
    const list = JSON.parse(store.getSetting(KEY) ?? "[]") as SavedPrompt[];
    // Re-checked on read: the text goes into a pane, so a row written some
    // other way than checkPrompt must not reach one.
    return Array.isArray(list)
      ? list.filter((p) => p && typeof p.id === "string" && !("error" in checkPrompt(p)))
      : [];
  } catch {
    return [];
  }
}

/** The prompt as saved, or why it can't be. It's pasted into a review pane,
 * which must only ever see ASCII. */
export function checkPrompt(input: { name?: unknown; text?: unknown }): { name: string; text: string } | { error: string } {
  if (typeof input.name !== "string" || typeof input.text !== "string") return { error: "A prompt needs a name and text." };
  const name = toAscii(input.name.trim());
  const text = toAscii(input.text.trim());
  if (!name.text || !text.text) return { error: "A prompt needs a name and text." };
  if (name.text.length > MAX_NAME) return { error: `Keep the name under ${MAX_NAME} characters.` };
  if (text.text.length > MAX_TEXT) return { error: `Keep the prompt under ${MAX_TEXT} characters.` };
  const left = [...new Set([...name.left, ...text.left])];
  if (left.length) return { error: `Use plain ASCII: remove ${left.join(" ")}` };
  return { name: name.text, text: text.text };
}

export function savePrompt(id: string | null, p: { name: string; text: string }): SavedPrompt | null {
  const list = listPrompts();
  if (id) {
    const at = list.findIndex((x) => x.id === id);
    if (at < 0) return null;
    list[at] = { id, ...p };
    store.setSetting(KEY, JSON.stringify(list));
    return list[at];
  }
  if (list.length >= MAX_PROMPTS) return null;
  const saved = { id: randomUUID().slice(0, 8), ...p };
  store.setSetting(KEY, JSON.stringify([...list, saved]));
  return saved;
}

export function deletePrompt(id: string): void {
  store.setSetting(KEY, JSON.stringify(listPrompts().filter((p) => p.id !== id)));
}
