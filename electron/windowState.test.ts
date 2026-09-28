import { describe, it, expect } from "vitest";
import { DEFAULT_SIZE, MIN_SIZE, parseWindowState, restoreBounds } from "./windowState.ts";

const LAPTOP = { x: 0, y: 25, width: 1512, height: 920 };
const MONITOR = { x: 1512, y: 0, width: 2560, height: 1415 };

describe("parseWindowState", () => {
  it("reads what main.ts saves", () => {
    expect(parseWindowState('{"x":10,"y":40,"width":1300,"height":900,"maximized":true}')).toEqual({
      x: 10, y: 40, width: 1300, height: 900, maximized: true,
    });
  });

  it("returns null for nothing saved, bad JSON, or missing fields, so launch never fails", () => {
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState("not json")).toBeNull();
    expect(parseWindowState('{"x":1,"y":2}')).toBeNull();
    expect(parseWindowState('{"x":"1","y":2,"width":3,"height":4}')).toBeNull();
  });
});

describe("restoreBounds", () => {
  it("opens at the default size, centred, when nothing is saved", () => {
    const b = restoreBounds(null, [LAPTOP]);
    expect(b).toMatchObject(DEFAULT_SIZE);
    expect(b.x).toBe(Math.round((LAPTOP.width - DEFAULT_SIZE.width) / 2));
  });

  it("puts the window back where it was", () => {
    const saved = { x: 1700, y: 100, width: 1600, height: 1000, maximized: false };
    expect(restoreBounds(saved, [LAPTOP, MONITOR])).toEqual({ x: 1700, y: 100, width: 1600, height: 1000 });
  });

  it("brings a window from an unplugged monitor back onto the laptop, at a size that fits", () => {
    const saved = { x: 1700, y: 100, width: 2400, height: 1300, maximized: false };
    const b = restoreBounds(saved, [LAPTOP]);
    expect(b.width).toBe(LAPTOP.width);
    expect(b.height).toBe(LAPTOP.height);
    expect(b.x).toBe(LAPTOP.x);
    expect(b.y).toBe(LAPTOP.y);
  });

  it("pulls a window hanging off an edge back inside the display", () => {
    const saved = { x: 1200, y: 25, width: 1240, height: 820, maximized: false };
    const b = restoreBounds(saved, [LAPTOP]);
    expect(b.x + b.width).toBeLessThanOrEqual(LAPTOP.x + LAPTOP.width);
  });

  it("never goes below the window's minimum size", () => {
    const saved = { x: 100, y: 100, width: 200, height: 100, maximized: false };
    expect(restoreBounds(saved, [LAPTOP])).toMatchObject(MIN_SIZE);
  });
});
