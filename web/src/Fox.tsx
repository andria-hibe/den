import { useEffect, useMemo, useState } from "react";
import { FOX_PALETTE, FOX_FRAMES, type FoxPose } from "./foxSprites.ts";

function rasterize(grid: string[]): { src: string; cols: number; rows: number } {
  const cols = Math.max(...grid.map((r) => r.length));
  const rows = grid.length;
  const canvas = document.createElement("canvas");
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    grid.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        const fill = FOX_PALETTE[ch];
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
  className,
}: {
  pose?: FoxPose;
  size?: number;
  className?: string;
}) {
  const frames = useMemo(() => FOX_FRAMES[pose].map(rasterize), [pose]);
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
