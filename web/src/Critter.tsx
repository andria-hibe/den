import { useMemo } from "react";
import { rasterize } from "./Fox.tsx";
import { BUSTS, CRITTERS, CRITTER_PALETTE, type CritterKind } from "./critterSprites.ts";

/** `a` moved `t` of the way to `b`; both "#rrggbb". */
function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return (
    "#" +
    [1, 3, 5]
      .map((i) => Math.round(ch(a, i) * (1 - t) + ch(b, i) * t).toString(16).padStart(2, "0"))
      .join("")
  );
}

function crop(grid: string[], [r0, r1, c0, c1]: [number, number, number, number]): string[] {
  return grid.slice(r0, r1).map((row) => row.slice(c0, c1));
}

/** One of Burrow's worker animals, drawn like the Fox: a native-res canvas
 * scaled by a whole number with image-rendering:pixelated, so it stays crisp. */
export function Critter({
  kind,
  size = 38,
  tint,
  bust = false,
  className,
}: {
  kind: CritterKind;
  size?: number;
  /** Draw only the head and shoulders (BUSTS), for small places. */
  bust?: boolean;
  /** A kit's scarf colour: its session's colour. */
  tint?: string;
  className?: string;
}) {
  const { src, cols, rows } = useMemo(
    () =>
      rasterize(
        bust && BUSTS[kind] ? crop(CRITTERS[kind], BUSTS[kind]) : CRITTERS[kind],
        tint ? { ...CRITTER_PALETTE, X: tint, Y: mix(tint, CRITTER_PALETTE.D, 0.4) } : CRITTER_PALETTE,
      ),
    [kind, tint, bust],
  );
  const scale = Math.max(1, Math.round(size / rows));
  return (
    <img
      className={className}
      src={src}
      width={cols * scale}
      height={rows * scale}
      style={{ imageRendering: "pixelated", display: "block" }}
      alt=""
      aria-hidden="true"
    />
  );
}
