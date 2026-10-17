"use client";

import { useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { SeriesPoint, runningTotals } from "@/lib/series";
import { formatReporting } from "@/lib/money";
import { daysBefore, shortDate } from "@/lib/periods";
import { smoothPath } from "@/lib/smooth-path";

/**
 * THE RACE AGAINST THE LAST PERIOD, drawn under the total it ends on.
 *
 * The gold line is the money RUNNING UP through the window, so its last point
 * is the headline figure above it: the chart draws the number rather than
 * sitting beside it. The dashed line is the period the delta is measured
 * against, run up the same way. Where the gold line sits above the dashed one
 * the window is ahead of where the last one was by the same point, and the
 * moment the two cross is when it went ahead or fell behind — which a single
 * "-48%" cannot say.
 *
 * ONE MEASURE, ONE SCALE. Both lines are a running total in the reporting
 * currency on one zero-based axis. The day-by-day amounts that used to be the
 * chart are in the readout under the pointer instead; drawing them as bars
 * would need a second scale, and two scales on one chart invite reading a
 * crossing that means nothing.
 *
 * Both series come from the same source under the same condition as the two
 * totals the delta compares — see `cashSeries` and the `bank` block in
 * dashboard.tsx — so the end of the dashed line IS the figure the delta was
 * worked out against.
 *
 * The two windows can differ in length (a 31-day month against a 30-day one),
 * so each line is laid across the full width by its own share of its window:
 * a point two thirds across is two thirds of the way through either period.
 */
export function PaceChart({
  points,
  previous,
  previousName,
  className,
  height = 110,
  label,
}: {
  /** The window on screen, one value per day (or per bucket of days). */
  points: SeriesPoint[];
  /** The comparison window, built the same way. Null when there is none. */
  previous: SeriesPoint[] | null;
  /** What the comparison window is called on screen, e.g. "1–17 Sept". */
  previousName: string;
  className?: string;
  height?: number;
  /** Screen-reader description. */
  label: string;
}) {
  /**
   * THE LINES ARE DRAWN LEFT TO RIGHT WHEN THE WINDOW CHANGES, AND NEVER ON
   * ARRIVAL. A figure the server already knows must not be animated into
   * existence; when the date range moves, watching the race redraw is what
   * says the chart under a similar-looking total is a different fortnight.
   * `redraw` counts those changes and keys the clipped layer, which replays
   * the reveal. Adjusted during render, so the reveal starts on the same frame
   * the new window arrives rather than after a frame of the finished chart.
   */
  const still = useReducedMotion();
  const signature = `${points.length}:${points[0]?.day ?? ""}:${
    points[points.length - 1]?.day ?? ""
  }:${previous?.[0]?.day ?? ""}`;
  const [seen, setSeen] = useState(signature);
  const [redraw, setRedraw] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  if (seen !== signature) {
    setSeen(signature);
    setRedraw((n) => n + 1);
    setHover(null);
  }

  // One point is not a shape and none is not a chart.
  if (points.length < 2) return null;

  const run = runningTotals(points);
  const before = previous && previous.length > 1 ? runningTotals(previous) : null;

  // Zero is always on the axis. A refund can take a running total down, so the
  // floor is the lowest point either line reaches if that is below zero.
  const all = [...run, ...(before ?? []), 0];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const range = hi - lo || 1;
  // Ninety-six units of a 100-unit box: the floor four off the bottom so its
  // stroke is not clipped, the top twelve under the ceiling so the glow on the
  // line has room to fall off.
  const yOf = (v: number) => 96 - ((v - lo) / range) * 84;

  const at = (values: number[]) =>
    values.map((v, i) => ({ x: (i / (values.length - 1)) * 100, y: yOf(v) }));
  const now = at(run);
  const then = before ? at(before) : null;

  const line = smoothPath(now);
  const floor = yOf(0);
  const area = `${line} L100 ${floor.toFixed(2)} L0 ${floor.toFixed(2)} Z`;
  const last = now[now.length - 1];

  /** The comparison point at the same share of its own window. */
  const matching = (i: number) =>
    before ? Math.round((i / (run.length - 1)) * (before.length - 1)) : null;

  const track = (clientX: number) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const frac = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    setHover(Math.round(frac * (points.length - 1)));
  };

  const focus = hover === null ? null : now[hover];
  const j = hover === null ? null : matching(hover);
  const focusThen = j === null || !then ? null : then[j];

  return (
    <div className={className}>
      <div
        ref={box}
        style={{ position: "relative", height }}
        onPointerMove={(e) => track(e.clientX)}
        onPointerLeave={() => setHover(null)}
      >
        <motion.div
          key={redraw}
          style={{ position: "absolute", inset: 0 }}
          // A clip, not a stroke-dash: the drawing is stretched sideways by
          // `preserveAspectRatio="none"`, which would warp a dash animation.
          // The finished clip reaches 16px past the box so the glow and the
          // end dot are never shaved at the edge.
          initial={redraw === 0 || still ? false : { clipPath: "inset(-16px 100% -16px 0px)" }}
          animate={{ clipPath: "inset(-16px -16px -16px 0px)" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Guides at quarter heights and the zero line, in HTML so a dashed
              rule is not pulled out of shape by the stretch. */}
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {[0.25, 0.5, 0.75].map((f) => (
              <span
                key={f}
                className="absolute inset-x-0 border-t border-dashed border-white/[0.05]"
                style={{ top: `${96 - f * 84}%` }}
              />
            ))}
            <span
              className="absolute inset-x-0 border-t border-white/[0.08]"
              style={{ top: `${floor}%` }}
            />
          </div>

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={label}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "visible" }}
          >
            <defs>
              {/* Shared ids on purpose: a generated id differs between the
                  server render and the client one and fails hydration. */}
              <linearGradient id="pace-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#d4af37" stopOpacity="0.30" />
                <stop offset="60%" stopColor="#d4af37" stopOpacity="0.07" />
                <stop offset="100%" stopColor="#d4af37" stopOpacity="0" />
              </linearGradient>
              {/* In user space, because a flat line has a bounding box with
                  no height and a bounding-box gradient on it paints nothing. */}
              <linearGradient id="pace-stroke" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">
                <stop offset="0%" stopColor="#b8942c" stopOpacity="0.75" />
                <stop offset="100%" stopColor="#f0d98a" />
              </linearGradient>
            </defs>

            <path d={area} fill="url(#pace-fill)" />

            {then && (
              <path
                d={smoothPath(then)}
                fill="none"
                stroke="#a1a1aa"
                strokeOpacity="0.55"
                strokeWidth="1.25"
                strokeDasharray="3 4"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>

          {/* The gold line in its own layer so its glow is a CSS filter, which
              is applied after the stretch and so stays round. */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              overflow: "visible",
              filter: "drop-shadow(0 0 6px #d4af3770)",
            }}
          >
            <path
              d={line}
              fill="none"
              stroke="url(#pace-stroke)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* Where each line has got to. Outside the SVG so they stay round. */}
          {then && (
            <Dot
              x={then[then.length - 1].x}
              y={then[then.length - 1].y}
              className="h-[6px] w-[6px] bg-zinc-400"
              dim={focus !== null}
            />
          )}
          <span
            aria-hidden
            className="absolute"
            style={{ left: `${last.x}%`, top: `${last.y}%`, opacity: focus ? 0.35 : 1, transition: "opacity 150ms ease" }}
          >
            <span className="live-halo absolute -left-[5px] -top-[5px] h-[10px] w-[10px] rounded-full bg-gold-400/60" />
            <span
              className="absolute -left-[4px] -top-[4px] h-[8px] w-[8px] rounded-full bg-gold-200"
              style={{ boxShadow: "0 0 0 2px var(--card), 0 0 12px 2px #d4af3799" }}
            />
          </span>
        </motion.div>

        {/* THE POINTER'S READOUT: where this window had got to by that day,
            what came in on the day itself, and where the last one was at the
            same point of its own window. */}
        {focus && hover !== null && (
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <span
              className="absolute top-0 bottom-0 w-px bg-gradient-to-b from-gold-300/0 via-gold-300/40 to-gold-300/0"
              style={{ left: `${focus.x}%` }}
            />
            {focusThen && (
              <span
                className="absolute h-[8px] w-[8px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-zinc-300 bg-[var(--card)]"
                style={{ left: `${focusThen.x}%`, top: `${focusThen.y}%` }}
              />
            )}
            <span
              className="absolute h-[10px] w-[10px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold-200 bg-[var(--card)] shadow-[0_0_14px_#d4af37aa]"
              style={{ left: `${focus.x}%`, top: `${focus.y}%` }}
            />
            <Readout
              x={focus.x}
              y={Math.min(focus.y, focusThen?.y ?? focus.y)}
              day={points[hover]}
              soFar={run[hover]}
              thenDay={j !== null && previous ? previous[j] : null}
              thenSoFar={j !== null && before ? before[j] : null}
            />
          </div>
        )}
      </div>

      {/* Two lines need a key, and colour alone must not carry it: the
          comparison is dashed as well as grey. */}
      {then && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-zinc-400">
          <span className="flex items-center gap-2">
            <span aria-hidden className="h-[2px] w-4 rounded-full bg-gradient-to-r from-gold-600 to-gold-300" />
            This period, running total
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className="w-4 border-t border-dashed border-zinc-400" />
            {previousName}, same point
          </span>
        </div>
      )}
    </div>
  );
}

function Dot({ x, y, className, dim }: { x: number; y: number; className: string; dim: boolean }) {
  return (
    <span
      aria-hidden
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${className}`}
      style={{ left: `${x}%`, top: `${y}%`, opacity: dim ? 0.35 : 1, transition: "opacity 150ms ease" }}
    />
  );
}

function Readout({
  x,
  y,
  day,
  soFar,
  thenDay,
  thenSoFar,
}: {
  x: number;
  y: number;
  day: SeriesPoint;
  soFar: number;
  thenDay: SeriesPoint | null;
  thenSoFar: number | null;
}) {
  const gap = thenSoFar === null ? null : soFar - thenSoFar;
  return (
    <div
      className="absolute w-max min-w-[180px] rounded-lg border border-white/[0.10] bg-[#1c1c21]/95 px-3 py-2.5 text-[11px] shadow-2xl backdrop-blur"
      style={{
        left: `${x}%`,
        top: `calc(${y}% - 14px)`,
        // Kept inside the card at both ends of the window.
        transform: `translate(${x < 18 ? "-8%" : x > 82 ? "-92%" : "-50%"}, -100%)`,
      }}
    >
      <div className="mb-1.5 text-zinc-400">{dayLabel(day)}</div>
      <div className="flex items-baseline justify-between gap-4">
        <span className="flex items-center gap-1.5 text-zinc-300">
          <span aria-hidden className="h-[2px] w-2.5 rounded-full bg-gold-300" />
          So far
        </span>
        <span className="font-num text-[13px] font-semibold tabular-nums text-zinc-50">
          {formatReporting(soFar)}
        </span>
      </div>
      {day.value !== 0 && (
        <div className="mt-0.5 text-right text-zinc-400">
          <span className="font-num tabular-nums text-zinc-300">
            {day.value > 0 ? "+" : "−"}
            {formatReporting(Math.abs(day.value))}
          </span>{" "}
          {day.days > 1 ? "in those days" : "on the day"}
        </div>
      )}
      {thenDay && thenSoFar !== null && (
        <div className="mt-1.5 flex items-baseline justify-between gap-4 border-t border-white/[0.07] pt-1.5">
          <span className="flex items-center gap-1.5 text-zinc-400">
            <span aria-hidden className="w-2.5 border-t border-dashed border-zinc-400" />
            By {shortDate(lastDayOf(thenDay))}
          </span>
          <span className="font-num tabular-nums text-zinc-300">{formatReporting(thenSoFar)}</span>
        </div>
      )}
      {gap !== null && gap !== 0 && (
        <div className="mt-1 flex items-center justify-end gap-1 text-zinc-300">
          {gap > 0 ? (
            <ArrowUpRight className="h-3 w-3 text-[var(--color-positive)]" strokeWidth={2.5} />
          ) : (
            <ArrowDownRight className="h-3 w-3 text-[var(--color-negative)]" strokeWidth={2.5} />
          )}
          <span className="font-num tabular-nums">{formatReporting(Math.abs(gap))}</span>
          {gap > 0 ? "ahead" : "behind"}
        </div>
      )}
    </div>
  );
}

/** The last day a point covers — the day itself, or the end of its bucket. */
function lastDayOf(point: SeriesPoint): string {
  return point.days <= 1 ? point.day : daysBefore(point.day, -(point.days - 1));
}

/** "17 Oct", or "1 Oct – 7 Oct" for a point that rolls several days together. */
function dayLabel(point: SeriesPoint): string {
  if (point.days <= 1) return shortDate(point.day);
  return `${shortDate(point.day)} – ${shortDate(lastDayOf(point))}`;
}
