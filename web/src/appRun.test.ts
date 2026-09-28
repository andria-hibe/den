import { describe, it, expect } from "vitest";
import { canStop, shortCommand, type AppRunner } from "./AppRunButton.tsx";

const base: AppRunner = { name: "runn", kind: "runn", running: false, dir: "/r", command: "runn up", stopCommand: "runn down" };

describe("canStop", () => {
  it("offers stop for a runn stack with any container up, even with the app itself down", () => {
    expect(canStop({ ...base, containersUp: 3 })).toBe(true);
  });
  it("hides it when nothing is up", () => {
    expect(canStop({ ...base, containersUp: 0 })).toBe(false);
  });
  it("offers it for a script app only when den started it in a tab", () => {
    const script: AppRunner = { name: "den", kind: "script", running: null, dir: "/d", command: "npm run dev" };
    expect(canStop(script)).toBe(false);
    expect(canStop({ ...script, appTab: true })).toBe(true);
  });
});

describe("shortCommand", () => {
  it("reads conductor.json's guarded script as the command it runs", () => {
    expect(shortCommand("command -v runn >/dev/null 2>&1 && runn down || echo 'runn CLI not found, skipping'")).toBe("runn down");
  });
  it("leaves a plain command alone", () => {
    expect(shortCommand("./scripts/setup-worktree.sh")).toBe("./scripts/setup-worktree.sh");
  });
});
