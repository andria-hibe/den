import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { openArgs } from "./openPath.ts";

describe("openArgs", () => {
  const dir = mkdtempSync(join(homedir(), ".den-openpath-test-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string) => {
    const p = join(dir, name);
    writeFileSync(p, "x");
    return p;
  };

  it("opens a viewable file but only reveals one that could run", () => {
    expect(openArgs(file("shot.png"))).toEqual([expect.stringContaining("shot.png")]);
    expect(openArgs(file("run.command"))?.[0]).toBe("-R");
  });

  it("refuses paths outside home and missing files", () => {
    expect(openArgs("/etc/hosts")).toBeNull();
    expect(openArgs(join(dir, "missing.png"))).toBeNull();
  });
});
