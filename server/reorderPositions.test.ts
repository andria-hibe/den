import { describe, it, expect } from "vitest";
import { reorderPositions } from "./sessions.ts";

// Two workspaces, one of which has an extra shell tab.
const SESSIONS = [
  { id: "a-main", groupId: "a", pos: 100 },
  { id: "a-shell", groupId: "a", pos: 100 },
  { id: "b-main", groupId: "b", pos: 200 },
];

describe("reorderPositions", () => {
  it("gives every pane of a workspace its workspace's new slot", () => {
    const pos = reorderPositions(SESSIONS, ["b", "a"]);
    expect(pos.get("b-main")).toBe(0);
    expect(pos.get("a-main")).toBe(1);
    expect(pos.get("a-shell")).toBe(1);
  });

  it("parks a workspace the client didn't name after the ordered ones", () => {
    // A session created between the drag and the request lands at the end,
    // keeping its position relative to any other unnamed workspace.
    const sessions = [...SESSIONS, { id: "c-main", groupId: "c", pos: 300 }];
    const pos = reorderPositions(sessions, ["b", "a"]);
    expect(pos.get("c-main")).toBe(2);
  });

  it("ranks several unnamed workspaces by their current position", () => {
    const sessions = [
      { id: "x", groupId: "x", pos: 900 },
      { id: "y", groupId: "y", pos: 300 },
    ];
    const pos = reorderPositions(sessions, []);
    expect(pos.get("y")).toBe(0);
    expect(pos.get("x")).toBe(1);
  });
});
