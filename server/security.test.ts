import { describe, it, expect } from "vitest";
import { isLocalRequest } from "./security.ts";

describe("isLocalRequest", () => {
  it("allows a loopback Host with no Origin (non-browser / navigation)", () => {
    expect(isLocalRequest({ host: "127.0.0.1:4321" })).toBe(true);
    expect(isLocalRequest({ host: "localhost:5173" })).toBe(true);
    expect(isLocalRequest({ host: "[::1]:4321" })).toBe(true);
  });

  it("allows a loopback Host with a loopback Origin", () => {
    expect(
      isLocalRequest({ host: "127.0.0.1:4321", origin: "http://127.0.0.1:4321" }),
    ).toBe(true);
    expect(
      isLocalRequest({ host: "localhost:4321", origin: "http://localhost:5173" }),
    ).toBe(true);
  });

  it("rejects a cross-origin request (CSWSH)", () => {
    expect(
      isLocalRequest({ host: "127.0.0.1:4321", origin: "https://evil.example.com" }),
    ).toBe(false);
  });

  it("rejects a non-loopback Host (DNS rebinding)", () => {
    expect(isLocalRequest({ host: "evil.example.com" })).toBe(false);
    expect(isLocalRequest({ host: "192.168.1.5:4321" })).toBe(false);
  });

  it("rejects when Host is missing entirely", () => {
    expect(isLocalRequest({})).toBe(false);
  });

  it("rejects a garbage / unparseable Host", () => {
    expect(isLocalRequest({ host: "@@@" })).toBe(false);
  });

  it("tolerates the literal 'null' Origin (sandboxed iframe / file://)", () => {
    // A "null" origin isn't a cross-site origin we can attribute; the loopback
    // Host is the real gate, so this should pass rather than hard-fail.
    expect(isLocalRequest({ host: "127.0.0.1:4321", origin: "null" })).toBe(true);
  });
});
