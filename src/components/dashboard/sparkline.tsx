"use client";

import { SeriesPoint } from "@/lib/series";

/**
 * The shape of the window, under the number that summarises it.
 *
 * Drawn in a 0–100 box and stretched to whatever width the tile is, with
 * `vector-effect="non-scaling-stroke"` so the line stays one pixel wide rather
 * than being stretched into a wedge. That is the whole trick, and it means the
 * same component works in a hero tile and in a table cell.
 *
 * THE BASELINE IS ALWAYS ZERO. Scaling to the lowest value makes a week that
 * ran between $9,000 and $10,000 look like a collapse and a recovery. The area
 * under the line has to mean the money.
 */
export function Sparkline({
  points,
  className,
  height = 56,
  label,
}: {
  points: SeriesPoint[];
  className?: string;
  height?: number;
  /** Screen-reader description. The drawing restates the total above it. */
  label: string;
}) {
  // One point is not a shape and none is not a chart. Both draw nothing rather
  // than a flat line at an arbitrary height, which would read as real.
  if (points.length < 2) return null;

  const peak = Math.max(...points.map((p) => p.value), 0);
  // Everything at zero is a real answer; dividing by it is not.
  const scale = peak > 0 ? peak : 1;

  const step = 100 / (points.length - 1);
  const coords = points.map((p, i) => ({
    x: i * step,
    // SVG y grows downward. Two units of headroom keeps the peak's stroke off
    // the top edge of the box.
    y: 98 - (p.value / scale) * 96,
    point: p,
  }));

  const line = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L100 100 L0 100 Z`;
  const last = coords[coords.length - 1];

  return (
    <div className={className} style={{ position: "relative", height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ height: "100%", width: "100%", display: "block" }}
        role="img"
        aria-label={label}
      >
        <defs>
          {/* One shared id on purpose. A generated id differs between the
              server render and the client one and fails hydration; the
              gradient is identical everywhere it is used, so sharing is
              correct rather than a shortcut. */}
          <linearGradient id="sparkline-gold" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d4af37" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
          </linearGradient>
        </defs>

        <path d={area} fill="url(#sparkline-gold)" />
        <path
          d={line}
          fill="none"
          stroke="#e5c158"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* THE MOST RECENT DAY, MARKED. Outside the SVG because the box is
          stretched horizontally — a <circle> inside it would be drawn as a
          flattened ellipse, and `vector-effect` only rescues strokes, not
          fills. Positioned in percentages against the same box. */}
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: `${last.x}%`,
          top: `${last.y}%`,
          width: 5,
          height: 5,
          marginLeft: -3.5,
          marginTop: -2.5,
          borderRadius: 999,
          background: "#e5c158",
          boxShadow: "0 0 0 2px #0f0f12",
        }}
      />
    </div>
  );
}
