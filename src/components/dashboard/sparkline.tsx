"use client";

import { SeriesPoint } from "@/lib/series";

/**
 * The shape of the window under the number that summarises it.
 *
 * Drawn in a 0–100 box and stretched to whatever width the tile is, with
 * `vector-effect="non-scaling-stroke"` so the line stays one pixel wide
 * instead of being stretched into a wedge. That is the whole trick: it means
 * the same component works in a hero tile and in a table cell.
 *
 * THE BASELINE IS ALWAYS ZERO. Scaling to the minimum value makes a week that
 * ran between £9,000 and £10,000 look like a collapse and a recovery. The area
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
  /** Screen-reader description. The visual is decoration on top of the total. */
  label: string;
}) {
  // One point is not a shape, and no points is not a chart. Both render
  // nothing rather than a misleading flat line at an arbitrary height.
  if (points.length < 2) return null;

  const peak = Math.max(...points.map((p) => p.value), 0);
  // Everything at zero: a flat line on the floor is honest, a divide by zero
  // is not.
  const scale = peak > 0 ? peak : 1;

  const step = 100 / (points.length - 1);
  const coords = points.map((p, i) => {
    const x = i * step;
    // SVG y grows downward, and 2 units of headroom keeps the peak's stroke
    // from being clipped by the top edge of the viewBox.
    const y = 98 - (p.value / scale) * 96;
    return { x, y, point: p };
  });

  const line = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(" ");
  const area = `${line} L100 100 L0 100 Z`;

  const highest = coords.reduce((best, c) =>
    c.point.value > best.point.value ? c : best
  );

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={className}
      style={{ height, width: "100%" }}
      role="img"
      aria-label={label}
    >
      <defs>
        {/* Scoped to this instance would need an id per render; the gradient is
            identical everywhere it is used, so one shared id is correct and
            avoids a hydration mismatch from a generated one. */}
        <linearGradient id="sparkline-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4af37" stopOpacity="0.28" />
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
      {peak > 0 && (
        <circle
          cx={highest.x}
          cy={highest.y}
          r="2"
          fill="#e5c158"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
