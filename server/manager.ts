// The prompt "Start my day" submits to the Manager pane (#46). Its rules live
// in managerInstruction; this only says what to do now.

export function managerStartPrompt(now: Date): string {
  const day = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    `Start my day. It's ${day}. den has just refreshed the digest: read it, ` +
    `write today's list, then take me through it one item at a time.`
  );
}

/** The Today list with its `n`th checklist item (0-based, in file order)
 * ticked or unticked, or null when there's no such item or, given `text`,
 * the item there now says something else: the list was rewritten after the
 * view showed it, and the index would flip the wrong item. */
export function toggleTodayItem(md: string, n: number, text?: string): string | null {
  let i = 0;
  let found = false;
  const out = md.replace(/^(\s*- \[)( |x|X)(\] )(.*)$/gm, (all, open: string, mark: string, close: string, rest: string) => {
    if (i++ !== n) return all;
    if (text !== undefined && rest.trim() !== text.trim()) return all;
    found = true;
    return `${open}${mark === " " ? "x" : " "}${close}${rest}`;
  });
  return found ? out : null;
}

/** Each checklist item's text, in the order toggleTodayItem counts them. */
export function todayItemTexts(md: string): string[] {
  return [...md.matchAll(/^\s*- \[(?: |x|X)\] (.*)$/gm)].map((m) => m[1].trim());
}
