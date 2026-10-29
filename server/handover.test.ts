import { describe, expect, it } from "vitest";
import { HANDOVER_TEMPLATE, waitingItems } from "../shared/handover.ts";

describe("waitingItems", () => {
  it("lists what the developer owes, and nothing for the empty handover", () => {
    expect(waitingItems(HANDOVER_TEMPLATE)).toEqual([]);
    const md = "## Waiting on you\n\n- Approve the commit message.\n- Say when to merge.\n\n---\n\n## Session notes\n\n- x\n";
    expect(waitingItems(md)).toEqual(["Approve the commit message.", "Say when to merge."]);
  });
});
