import { describe, it, expect } from "vitest";
import { moveItem, sortByGroupOrder } from "./reorder.ts";

describe("moveItem", () => {
  it("moves an item down", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });
  it("moves an item up", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
  it("returns the same list for a no-op or out-of-range move", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, 0, 5)).toBe(list);
    expect(moveItem(list, -1, 0)).toBe(list);
  });
});

describe("sortByGroupOrder", () => {
  const s = (id: string, groupId: string) => ({ id, groupId });

  it("orders sessions by their workspace order", () => {
    const list = [s("a1", "a"), s("b1", "b"), s("c1", "c")];
    expect(sortByGroupOrder(list, ["c", "a", "b"]).map((x) => x.id)).toEqual([
      "c1",
      "a1",
      "b1",
    ]);
  });

  it("keeps a workspace's panes together, in their own order", () => {
    const list = [s("a-main", "a"), s("a-shell", "a"), s("b-main", "b")];
    expect(sortByGroupOrder(list, ["b", "a"]).map((x) => x.id)).toEqual([
      "b-main",
      "a-main",
      "a-shell",
    ]);
  });

  it("parks an unnamed workspace after the named ones", () => {
    const list = [s("a1", "a"), s("new1", "new"), s("b1", "b")];
    expect(sortByGroupOrder(list, ["b", "a"]).map((x) => x.id)).toEqual([
      "b1",
      "a1",
      "new1",
    ]);
  });
});
