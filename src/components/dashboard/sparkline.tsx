"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { SeriesPoint } from "@/lib/series";
import { formatReporting } from "@/lib/money";
import { daysBefore, shortDate } from "@/lib/periods";
import { smoothPath } from "@/lib/smooth-path";

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
  // The point under the pointer, or null when nobody is pointing at the chart.
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  if (seen !== signature) {
    setSeen(signature);
    setRedraw((n) => n + 1);
    setHover(null);
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
    // SVG y grows downward. Zero sits three units off the floor so its stroke
    // is not clipped; the peak sits twelve under the ceiling so the glow
    // around the line has room to fall off before the edge of the box.
    y: 97 - (p.value / scale) * 85,
    point: p,
  }));

  const line = smoothPath(coords);
  const area = `${line} L100 100 L0 100 Z`;
  const last = coords[coords.length - 1];
  const focus = hover === null ? null : coords[hover];

  /** The nearest point to the pointer, by x alone — a scrubber, not a hit test. */
  const track = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (points.length - 1)));
  };

  return (
    <div
      ref={box}
      className={className}
      style={{ position: "relative", height }}
      onPointerMove={(e) => track(e.clientX)}
      onPointerLeave={() => setHover(null)}
    >
      <motion.div
        key={redraw}
        style={{ position: "absolute", inset: 0 }}
        // The reveal is a CLIP, not a stroke-dash: this box is stretched
        // horizontally by `preserveAspectRatio="none"`, which distorts a dash
        // pattern into something that speeds up and slows down across the width.
        // Clipping the box reveals the line, the area fill under it and the dot
        // on the last day together, at one honest speed.
        //
        // `initial: false` on the very first render is the whole point — see the
        // note at the top of this component.
        //
        // The finished clip reaches 16px PAST the box on three sides, so the
        // glow around the line and the dot on today are never cut at the edge —
        // the old `inset(0 0% 0 0)` shaved the edge off the last day's dot.
        initial={redraw === 0 || still ? false : { clipPath: "inset(-16px 100% -16px 0px)" }}
        animate={{ clipPath: "inset(-16px -16px -16px 0px)" }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        {/* GUIDES, NOT AN AXIS. Three faint rules at quarter heights and a floor,
            drawn in HTML rather than in the stretched SVG, where a dash pattern
            would be pulled out of shape across the width. They give the eye a
            scale to read the curve against without printing numbers on it. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {[0.25, 0.5, 0.75].map((f) => (
            <span
              key={f}
              className="absolute inset-x-0 border-t border-dashed border-white/[0.05]"
              style={{ top: `${97 - f * 85}%` }}
            />
          ))}
          <span className="absolute inset-x-0 bottom-0 border-t border-white/[0.07]" />
        </div>

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          style={{ position: "absolute", inset: 0, height: "100%", width: "100%", display: "block" }}
          role="img"
          aria-label={label}
        >
          <defs>
            {/* Shared ids on purpose. A generated id differs between the server
                render and the client one and fails hydration; the gradients are
                identical everywhere they are used, so sharing is correct rather
                than a shortcut. */}
            <linearGradient id="sparkline-gold" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#d4af37" stopOpacity="0.34" />
              <stop offset="55%" stopColor="#d4af37" stopOpacity="0.08" />
              <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
            </linearGradient>
            {/* The line warms as it reaches the present: deep gold at the start
                of the window, pale gold at today. */}
            {/* In user space, not the path's bounding box: a window of all-zero
                days draws a flat line with a bounding box of no height, and a
                bounding-box gradient on that paints nothing at all. */}
            <linearGradient
              id="sparkline-stroke"
              gradientUnits="userSpaceOnUse"
              x1="0"
              y1="0"
              x2="100"
              y2="0"
            >
              <stop offset="0%" stopColor="#b8942c" stopOpacity="0.7" />
              <stop offset="100%" stopColor="#f0d98a" />
            </linearGradient>
          </defs>

          <path d={area} fill="url(#sparkline-gold)" />
        </svg>

        {/* The line in its own layer so the glow can be a CSS filter, which is
            applied in screen pixels after the stretch — an SVG blur inside the
            stretched box would smear sideways and stay crisp vertically. */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            height: "100%",
            width: "100%",
            display: "block",
            overflow: "visible",
            filter: "drop-shadow(0 0 6px #d4af3770)",
          }}
        >
          <path
            d={line}
            fill="none"
            stroke="url(#sparkline-stroke)"
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* THE MOST RECENT DAY, MARKED. Outside the SVG because the box is
            stretched horizontally — a <circle> inside it would be drawn as a
            flattened ellipse, and `vector-effect` only rescues strokes, not
            fills. Positioned in percentages against the same box. A slow halo
            behind it, stilled with every other animation under reduced motion. */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: `${last.x}%`,
            top: `${last.y}%`,
            width: 0,
            height: 0,
            opacity: focus ? 0.35 : 1,
            transition: "opacity 150ms ease",
          }}
        >
          <span className="live-halo absolute -left-[5px] -top-[5px] h-[10px] w-[10px] rounded-full bg-gold-400/60" />
          <span
            className="absolute -left-[3.5px] -top-[3.5px] h-[7px] w-[7px] rounded-full bg-gold-200"
            // The card behind it, by token. It was the hex #0f0f12, typed here
            // and nowhere else, so raising the card surface on 2026-09-04 left
            // this ring painting the OLD colour — a dark halo around the dot on
            // every sparkline, on a card that had moved out from under it.
            style={{ boxShadow: "0 0 0 2px var(--card), 0 0 10px 2px #d4af3799" }}
          />
        </span>

      </motion.div>

      {/* THE DAY UNDER THE POINTER. A hairline down to the floor, a dot on the
          curve, and the day with what came in on it — the one thing a shape
          cannot tell you is how tall any single day was. */}
      {focus && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <span
            className="absolute bottom-0 w-px bg-gradient-to-b from-gold-300/50 to-gold-300/0"
            style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
          />
          <span
            className="absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold-200 bg-[var(--card)] shadow-[0_0_12px_#d4af37aa]"
            style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
          />
          <span
            className="absolute whitespace-nowrap rounded-md border border-white/[0.10] bg-[#1c1c21]/95 px-2 py-1 text-[11px] shadow-xl backdrop-blur"
            style={{
              top: `calc(${focus.y}% - 10px)`,
              // Kept inside the box at both ends, so the first and last days
              // do not hang their label off the card.
              left: `${focus.x}%`,
              transform: `translate(${
                focus.x < 12 ? "0%" : focus.x > 88 ? "-100%" : "-50%"
              }, -100%)`,
            }}
          >
            <span className="text-zinc-400">{dayLabel(focus.point)}</span>
            <span className="ml-2 font-num font-medium tabular-nums text-zinc-50">
              {formatReporting(focus.point.value)}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

/** "17 Oct", or "1 Oct – 7 Oct" for a point that rolls several days together. */
function dayLabel(point: SeriesPoint): string {
  if (point.days <= 1) return shortDate(point.day);
  return `${shortDate(point.day)} – ${shortDate(daysBefore(point.day, -(point.days - 1)))}`;
}
