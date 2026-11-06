import { describe, expect, it } from "vitest";
import { HANDOVER_TEMPLATE, canStartFresh, waitingItems } from "../shared/handover.ts";

describe("waitingItems", () => {
  it("lists what the developer owes, and nothing for the empty handover", () => {
    expect(waitingItems(HANDOVER_TEMPLATE)).toEqual([]);
    const md = "## Waiting on you\n\n- Approve the commit message.\n- Say when to merge.\n\n---\n\n## Session notes\n\n- x\n";
    expect(waitingItems(md)).toEqual(["Approve the commit message.", "Say when to merge."]);
  });
});

describe("canStartFresh", () => {
  const pane = { shell: false, role: "main", look: false, view: null as string | null, owned: false, handover: true };
  it("covers workspaces, a PR taken on as your own, and Fox, but no other pane", () => {
    expect(canStartFresh(pane)).toBe(true);
    expect(canStartFresh({ ...pane, view: "review", owned: true })).toBe(true);
    expect(canStartFresh({ ...pane, view: "manager" })).toBe(true);
    expect(canStartFresh({ ...pane, view: "review" })).toBe(false);
    expect(canStartFresh({ ...pane, view: "mypr", owned: true })).toBe(false);
    expect(canStartFresh({ ...pane, look: true })).toBe(false);
    expect(canStartFresh({ ...pane, handover: false })).toBe(false);
  });
});
