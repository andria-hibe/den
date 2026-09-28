import { describe, it, expect } from "vitest";
import { sqliteBinding } from "./nativeBinding.ts";

const rel = "native/electron-43.0.0/better_sqlite3.node";

describe("sqliteBinding", () => {
  it("uses node_modules under plain Node", () => {
    expect(sqliteBinding(undefined, undefined, "/repo", () => true)).toBeUndefined();
  });

  it("finds the Electron build next to app.asar in the packaged app", () => {
    const res = "/Applications/Den.app/Contents/Resources";
    expect(sqliteBinding("43.0.0", res, "/", (p) => p.startsWith(res))).toBe(`${res}/app.asar.unpacked/${rel}`);
  });

  it("finds it in the repo when run with `electron .`", () => {
    expect(sqliteBinding("43.0.0", undefined, "/repo", (p) => p === `/repo/${rel}`)).toBe(`/repo/${rel}`);
  });

  it("falls back to node_modules when no Electron build exists, so the error can say what to run", () => {
    expect(sqliteBinding("43.0.0", "/res", "/repo", () => false)).toBeUndefined();
  });
});
