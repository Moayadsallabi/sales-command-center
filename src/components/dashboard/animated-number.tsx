"use client";

import { formatReporting } from "@/lib/money";

interface AnimatedNumberProps {
  value: number;
  format?: "number" | "currency" | "percent";
  className?: string;
  /**
   * Classes for each character rather than for the whole figure. A gradient
   * clipped to the text has to sit on the glyphs themselves here: each digit
   * is its own moving layer, and a parent's `background-clip: text` does not
   * reliably reach text inside a transformed child.
   */
  glyphClassName?: string;
}

/**
 * A figure that ROLLS when it changes, and is simply correct when it does not.
 *
 * Each digit is a column of 0–9 behind a one-digit window; changing the value
 * slides every column to its new digit, like the wheels of an odometer. A
 * period change therefore reads as the number turning over rather than as a
 * spring counting through every value in between.
 *
 * NOTHING ROLLS ON ARRIVAL. The first render places every column at its final
 * digit with no transition, so the server's markup is already the answer and
 * hydration changes nothing. This used to count up from zero on mount behind
 * an IntersectionObserver, and in a background tab the tile sat at $0 — not a
 * missing number but a wrong one. The transition only ever runs between two
 * real values: the date range moving, a filter landing, a refresh bringing in
 * a new call.
 *
 * Columns are keyed by their place counted from the RIGHT, so the units stay
 * the units when a figure gains a digit; the new leading digit simply appears.
 *
 * Reduced motion: the transition is CSS, so the `prefers-reduced-motion` block
 * in globals.css stills it and the digits change in place.
 *
 * Screen readers get the formatted figure once, from a visually hidden span;
 * the wheels themselves are hidden, or every column would be read as "0 1 2 3
 * 4 5 6 7 8 9".
 */
export function AnimatedNumber({
  value,
  format = "number",
  className,
  glyphClassName,
}: AnimatedNumberProps) {
  const text = formatValue(value, format);
  const chars = [...text];

  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "baseline" }}>
      <span className="sr-only">{text}</span>
      {/* Baseline, not the flex default of stretch: a wheel is a touch
          taller than a separator, and top-aligned the digits sat above the
          "$" and the comma. Each wheel's baseline is its hidden sizing "0". */}
      <span aria-hidden style={{ display: "inline-flex", alignItems: "baseline" }}>
        {chars.map((ch, i) => {
          const place = chars.length - i;
          return /\d/.test(ch) ? (
            <Wheel key={`d${place}`} digit={Number(ch)} place={place} glyphClassName={glyphClassName} />
          ) : (
            // The same box as a wheel. Left to the inherited line height, a
            // "%" or "$" stood half again as tall as the digits beside it and
            // pushed the whole figure down its row.
            <span
              key={`c${place}-${ch}`}
              className={glyphClassName}
              style={{ height: `${ROW}em`, lineHeight: `${ROW}em` }}
            >
              {ch}
            </span>
          );
        })}
      </span>
    </span>
  );
}

/** Row height in em. A touch over 1 so no glyph's top or tail is clipped. */
const ROW = 1.12;

function Wheel({
  digit,
  place,
  glyphClassName,
}: {
  digit: number;
  place: number;
  glyphClassName?: string;
}) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-block",
        height: `${ROW}em`,
        lineHeight: `${ROW}em`,
        overflow: "hidden",
      }}
    >
      {/* Sizes the window to one tabular digit; the column floats over it. */}
      <span style={{ visibility: "hidden" }}>0</span>
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          display: "flex",
          flexDirection: "column",
          transform: `translateY(${-digit * ROW}em)`,
          // Higher places turn a beat later than the units, so the wheels
          // ripple from right to left the way a counter turns over.
          transition: `transform 700ms cubic-bezier(0.22, 1, 0.36, 1) ${Math.min(place - 1, 6) * 35}ms`,
        }}
      >
        {DIGITS.map((d) => (
          <span key={d} className={glyphClassName} style={{ height: `${ROW}em` }}>
            {d}
          </span>
        ))}
      </span>
    </span>
  );
}

const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

function formatValue(v: number, format: string): string {
  const rounded = Math.round(v);
  switch (format) {
    // Every currency KPI is a total across calls, so it has already been
    // converted into the reporting currency by the money helpers.
    case "currency":
      return formatReporting(rounded);
    case "percent":
      return `${rounded}%`;
    // A fixed locale, so the server and the browser format the same figure
    // the same way and hydration has nothing to correct.
    default:
      return rounded.toLocaleString("en-US");
  }
}
