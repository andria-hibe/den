import { useEffect, useMemo, useState } from "react";
import { FOX_PALETTE, FOX_FRAMES, type FoxPose } from "./foxSprites.ts";

export function rasterize(
  grid: string[],
  palette: Record<string, string> = FOX_PALETTE,
): { src: string; cols: number; rows: number } {
  const cols = Math.max(...grid.map((r) => r.length));
  const rows = grid.length;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    grid.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const fill = palette[ch];
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(x, y, 1, 1);
        }
      });
    });
  }
  return { src: canvas.toDataURL(), cols, rows };
}

// Renders a full-body fox pose. Multi-frame poses (walk) animate. Sprites are
// painted to a native-res canvas and scaled up with image-rendering:pixelated,
// so they stay crisp regardless of sub-pixel position/animation/compositing.
export function Fox({
  pose = "sit",
  size = 96,
  bust = false,
  className,
}: {
  pose?: FoxPose;
  size?: number;
  /** Head and shoulders only, cropped like a kit's bust (critterSprites
   * BUSTS), to sit beside the kits and Owl in the rail. */
  bust?: boolean;
  className?: string;
}) {
  const frames = useMemo(
    () => FOX_FRAMES[pose].map((g) => rasterize(bust ? g.slice(0, 11).map((r) => r.slice(0, 15)) : g)),
    [pose, bust],
  );
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    setFrame(0);
    if (frames.length < 2) return;
    const id = setInterval(
      () => setFrame((f) => (f + 1) % frames.length),
      220,
    );
    return () => clearInterval(id);
  }, [frames]);

  const { src, cols, rows } = frames[frame] ?? frames[0];
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
