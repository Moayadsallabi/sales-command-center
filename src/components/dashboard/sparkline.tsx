"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
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
  /**
   * THE LINE IS DRAWN LEFT TO RIGHT WHEN THE WINDOW CHANGES, AND NEVER ON
   * ARRIVAL.
   *
   * Same rule the KPI figures follow next door: a number the server already
   * knows must not be animated into existence, because for the length of the
   * animation the tile is showing something other than the answer. On first
   * paint this is simply the shape of the window.
   *
   * When the date range moves it earns its keep — the shape is what changed,
   * and watching it redraw is what tells you the chart under an unchanged-
   * looking total is a different fortnight. `redraw` counts those changes and
   * keys the wrapper, which remounts it and replays the reveal.
   *
   * Hooks sit above the early return below so they run on every render.
   */
  const still = useReducedMotion();
  const signature = `${points.length}:${points[0]?.day ?? ""}:${
    points[points.length - 1]?.day ?? ""
  }`;

  // Adjusted DURING RENDER rather than in an effect. React documents this
  // shape for exactly this job — a piece of state that has to change when a
  // prop does — and it re-runs the component before anything is painted, so
  // the reveal starts on the same frame the new window arrives. The same code
  // in an effect would paint the finished chart first and then animate it in,
  // which is the flicker, and the linter rejects it outright.
  const [seen, setSeen] = useState(signature);
  const [redraw, setRedraw] = useState(0);
  if (seen !== signature) {
    setSeen(signature);
    setRedraw((n) => n + 1);
  }

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
    <motion.div
      key={redraw}
      className={className}
      style={{ position: "relative", height }}
      // The reveal is a CLIP, not a stroke-dash: this box is stretched
      // horizontally by `preserveAspectRatio="none"`, which distorts a dash
      // pattern into something that speeds up and slows down across the width.
      // Clipping the box reveals the line, the area fill under it and the dot
      // on the last day together, at one honest speed.
      //
      // `initial: false` on the very first render is the whole point — see the
      // note at the top of this component.
      initial={redraw === 0 || still ? false : { clipPath: "inset(0 100% 0 0)" }}
      animate={{ clipPath: "inset(0 0% 0 0)" }}
      transition={{ duration: 0.45, ease: "easeOut" }}
    >
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
          // The card behind it, by token. It was the hex #0f0f12, typed here
          // and nowhere else, so raising the card surface on 2026-09-04 left
          // this ring painting the OLD colour — a dark halo around the dot on
          // every sparkline, on a card that had moved out from under it.
          boxShadow: "0 0 0 2px var(--card)",
        }}
      />
    </motion.div>
  );
}
