// The prompt "Start my day" submits to the Manager pane (#46). Its rules live
// in managerInstruction; this only says what to do now.

/** `fresh`: the sessions den just started fresh, which wait for Fox's brief. */
export function managerStartPrompt(now: Date, fresh: string[] = []): string {
  const day = dayLabel(now);
  const woke = fresh.length
    ? ` den started these sessions fresh from their handovers, and they're waiting for your ` +
      `brief: ${fresh.map((n) => `"${n.replaceAll('"', "'")}"`).join(", ")}.`
    : "";
  return (
    `Start my day. It's ${day}. den has just refreshed the digest: read it, ` +
    `write today's list, brief the sessions, then take me through the list one item at a time.${woke}`
  );
}

/** The weekday and date as Today's heading writes them ("Friday 6 November"). */
export function dayLabel(now: Date): string {
  return now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** Whether the Today list is from an earlier day than `now`: its heading
 * names another date. A list with no heading isn't treated as old. */
export function todayIsOld(md: string, now: Date): boolean {
  const heading = /^# Today\b(.*)$/m.exec(md)?.[1];
  // Day and month only, so "Friday, 6th November" still counts as today.
  const m = heading && /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)/.exec(heading);
  if (!m) return false;
  const month = now.toLocaleDateString("en-GB", { month: "long" }).toLowerCase();
  return Number(m[1]) !== now.getDate() || !month.startsWith(m[2].toLowerCase().slice(0, 3));
}

/** Refresh, from Today's header: any time in the day, not just at the start.
 * `newDay`: the list is from an earlier day, so it starts over. */
export function managerRefreshPrompt(now: Date, newDay = false): string {
  const time = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const restart = newDay
    ? ` The Today list is from an earlier day: start a new one for ${dayLabel(now)} in the usual ` +
      `shape, carrying over only the items still open, and leave yesterday's ticked and won't-do ones out.`
    : "";
  return (
    `Refresh my day. It's ${time}.${restart} den has just rewritten the digest. Ask tanuki, your inbox ` +
    `subagent, to go through its Inbox section and pick easy approvals from its Team PRs ` +
    `section, then go through the Today list against the digest and what tanuki found: tick ` +
    `what's done, add what's new and needs me, drop what no longer applies, and rewrite ` +
    `the easy picks file. Read the list first and keep the boxes I ticked or marked won't do. Send each ` +
    `session anything new you found for it. Tell me in a few ` +
    `lines what changed, then carry on with me from where we were. I can ask for this any ` +
    `time, so keep it quick.`
  );
}

/** A Today item's box: "- [ ]" open, "- [x]" done, "- [-]" won't do. */
export type TodayItemState = "open" | "done" | "wontdo";
const BOX: Record<TodayItemState, string> = { open: " ", done: "x", wontdo: "-" };

/** The Today list with its `n`th checklist item (0-based, in file order) set
 * to `state`, or null when there's no such item or, given `text`, the item
 * there now says something else: the list was rewritten after the view
 * showed it, and the index would mark the wrong item. */
export function setTodayItem(md: string, n: number, state: TodayItemState, text?: string): string | null {
  let i = 0;
  let found = false;
  const out = md.replace(/^(\s*- \[)( |x|X|-)(\] )(.*)$/gm, (all, open: string, _mark: string, close: string, rest: string) => {
    if (i++ !== n) return all;
    if (text !== undefined && rest.trim() !== text.trim()) return all;
    found = true;
    return `${open}${BOX[state]}${close}${rest}`;
  });
  return found ? out : null;
}

/** Each checklist item's text and state, in the order setTodayItem counts them. */
export function todayItems(md: string): { text: string; state: TodayItemState }[] {
  return [...md.matchAll(/^\s*- \[( |x|X|-)\] (.*)$/gm)].map((m) => ({
    text: m[2].trim(),
    state: m[1] === " " ? "open" : m[1] === "-" ? "wontdo" : "done",
  }));
}

/** What den tells the Manager when a session's "Waiting on you" changes, or
 * null when nothing did. */
export function waitingChangeMessage(session: string, before: string[], after: string[]): string | null {
  // Whitespace, case, and end punctuation change on every rewrite of a handover.
  const norm = (i: string) => i.toLowerCase().replace(/\s+/g, " ").replace(/[.;:,!]+$/, "").trim();
  const was = new Set(before.map(norm));
  const now = new Set(after.map(norm));
  const gone = before.filter((i) => !now.has(norm(i)));
  const added = after.filter((i) => !was.has(norm(i)));
  if (!gone.length && !added.length) return null;
  const list = (items: string[]) => items.map((i) => `"${i.replaceAll('"', "'")}"`).join("; ");
  const parts = [
    gone.length ? `no longer waiting on the developer: ${list(gone)}` : null,
    added.length ? `now waiting on the developer: ${list(added)}` : null,
  ].filter(Boolean);
  return (
    `Session "${session}" changed the "Waiting on you" in its handover. ${parts.join(". ")}. ` +
    `A reworded item shows as one gone and one new: match them by meaning before you tick anything.`
  );
}
