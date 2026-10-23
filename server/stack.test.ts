import { describe, it, expect } from "vitest";
import { parentMovedMessage, type StackStatus } from "./stack.ts";

const status = (o: Partial<StackStatus>): StackStatus => ({
  parent: "p", stacked: true, behindParent: 2, behindOrigin: 0, ...o,
});

describe("parentMovedMessage", () => {
  it("speaks only when a stacked parent moved ahead", () => {
    expect(parentMovedMessage("aaa", "bbb", status({}))).toContain("2 commits behind");
    expect(parentMovedMessage(undefined, "bbb", status({}))).toBeNull();
    expect(parentMovedMessage("aaa", "bbb", status({ stacked: false }))).toBeNull();
    expect(parentMovedMessage("aaa", "bbb", status({ behindParent: 0 }))).toBeNull();
  });
});
