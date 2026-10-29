import { useMemo } from "react";
import { rasterize } from "./Fox.tsx";
import { CRITTERS, CRITTER_PALETTE, type CritterKind } from "./critterSprites.ts";

/** One of Burrow's worker animals, drawn like the Fox: a native-res canvas
 * scaled by a whole number with image-rendering:pixelated, so it stays crisp. */
export function Critter({
  kind,
  size = 38,
  tint,
  className,
}: {
  kind: CritterKind;
  size?: number;
  /** A kit's scarf colour: its session's colour. */
  tint?: string;
  className?: string;
}) {
  const { src, cols, rows } = useMemo(
    () => rasterize(CRITTERS[kind], tint ? { ...CRITTER_PALETTE, X: tint } : CRITTER_PALETTE),
    [kind, tint],
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
