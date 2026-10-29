// The prompt "Start my day" submits to the Manager pane (#46). Its rules live
// in managerInstruction; this only says what to do now.

export function managerStartPrompt(now: Date): string {
  const day = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    `Start my day. It's ${day}. den has just refreshed the digest: read it, ` +
    `write today's list, then take me through it one item at a time.`
  );
}
