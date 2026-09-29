// Where the den window opens: its saved bounds, kept on a display that still
// exists. No Electron import, so it can be unit-tested; main.ts does the
// Electron and storage calls.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState extends Rect {
  maximized: boolean;
}

export const DEFAULT_SIZE = { width: 1240, height: 820 };
export const MIN_SIZE = { width: 860, height: 540 };

/** How much of the window must sit on a display for the saved position to be
 * kept. Enough to grab the title bar and drag it back. */
const MIN_VISIBLE = { width: 120, height: 60 };

/** The saved state, or null when there is none or it is malformed (an older
 * format, a hand edit). Never throws, so a bad value can't stop the app
 * opening. */
export function parseWindowState(raw: string | null | undefined): WindowState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<WindowState>;
    const nums = [v.x, v.y, v.width, v.height];
    if (!nums.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    return {
      x: Math.round(v.x!),
      y: Math.round(v.y!),
      width: Math.round(v.width!),
      height: Math.round(v.height!),
      maximized: v.maximized === true,
    };
  } catch {
    return null;
  }
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

/**
 * The bounds to open the window at, given the saved state and each display's
 * work area (the part not covered by the menu bar or dock); the first work
 * area is the primary display.
 * - Nothing saved: the default size, centred on the primary display.
 * - Saved on a display that is still there: that position, with the size
 *   clamped to the display and the window pulled inside it.
 * - Saved on a display that is gone (an unplugged monitor), or so far off
 *   every display that the title bar can't be reached: the saved size, clamped
 *   and centred on the primary display.
 */
export function restoreBounds(saved: WindowState | null, workAreas: Rect[]): Rect {
  const primary = workAreas[0] ?? { x: 0, y: 0, ...DEFAULT_SIZE };
  const size = saved ?? DEFAULT_SIZE;
  const fit = (area: Rect) => ({
    width: Math.max(MIN_SIZE.width, Math.min(size.width, area.width)),
    height: Math.max(MIN_SIZE.height, Math.min(size.height, area.height)),
  });
  const centred = (area: Rect): Rect => {
    const { width, height } = fit(area);
    return {
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      width,
      height,
    };
  };
  if (!saved) return centred(primary);

  const home = workAreas.find((area) => {
    const o = overlap(saved, area);
    return o.width >= MIN_VISIBLE.width && o.height >= MIN_VISIBLE.height;
  });
  if (!home) return centred(primary);

  const { width, height } = fit(home);
  const clampX = Math.min(Math.max(saved.x, home.x), home.x + home.width - width);
  const clampY = Math.min(Math.max(saved.y, home.y), home.y + home.height - height);
  return { x: clampX, y: clampY, width, height };
}
