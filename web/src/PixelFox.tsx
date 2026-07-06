// Pixel-art fox mascot, drawn as a crisp SVG so it scales from tiny badges to
// big empty-state art without blurring. Verified visually at 5–22px/pixel.
const GRID = [
  "..DD........DD..",
  ".DOOD......DOOD.",
  ".DOpOD....DOpOD.",
  ".DOOOD....DOOOD.",
  ".DOOOOD..DOOOOD.",
  "DOOOOOOOOOOOOOOD",
  "DOOOOOOOOOOOOOOD",
  "DOOeeOOOOOOeeOOD",
  "DOOeeOOOOOOeeOOD",
  "DOOOOOOOOOOOOOOD",
  ".DOwwwwwwwwwwOD.",
  ".DOwwwwppwwwwOD.",
  "..DOwwwwwwwwOD..",
  "...DOwwwwwwOD...",
  "....DDOOOODD....",
];

const PALETTE: Record<string, string> = {
  D: "#5b4b66",
  O: "#f2a25c",
  p: "#ff9ec4",
  e: "#3a2e40",
  w: "#fff6fb",
};

const COLS = GRID[0].length;
const ROWS = GRID.length;

export function PixelFox({
  size = 32,
  className,
}: {
  /** Approximate rendered height in px; snapped to an integer pixel scale so
      the art stays crisp (non-integer scaling anti-aliases the pixels). */
  size?: number;
  className?: string;
}) {
  const scale = Math.max(1, Math.round(size / ROWS));
  const width = COLS * scale;
  const height = ROWS * scale;
  const rects: React.ReactNode[] = [];
  GRID.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const fill = PALETTE[ch];
      if (fill) {
        rects.push(
          <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill} />,
        );
      }
    });
  });
  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${COLS} ${ROWS}`}
      shapeRendering="crispEdges"
      style={{ imageRendering: "pixelated", display: "block" }}
      aria-hidden="true"
    >
      {rects}
    </svg>
  );
}
