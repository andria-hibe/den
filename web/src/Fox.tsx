import { useMemo } from "react";
import { FOX_PALETTE, FOX_SPRITES, type FoxPose } from "./foxSprites.ts";

// Renders a full-body fox pose. The sprite is painted to a native-resolution
// canvas (1px per cell) and scaled up as an <img> with image-rendering:pixelated
// — nearest-neighbour scaling stays perfectly crisp regardless of sub-pixel
// position, animation, or compositing (inline SVG blurs when offset by a
// fractional pixel, e.g. under flex-centering or a bob animation).
export function Fox({
  pose = "sit",
  size = 96,
  className,
}: {
  pose?: FoxPose;
  size?: number;
  className?: string;
}) {
  const grid = FOX_SPRITES[pose];
  const cols = Math.max(...grid.map((r) => r.length));
  const rows = grid.length;
  const scale = Math.max(1, Math.round(size / rows));

  const src = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    grid.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const fill = FOX_PALETTE[ch];
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(x, y, 1, 1);
        }
      });
    });
    return canvas.toDataURL();
  }, [grid, cols, rows]);

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
