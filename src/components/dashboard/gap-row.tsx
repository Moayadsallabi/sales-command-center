"use client";

/**
 * ONE ROW THAT DRAWS THE DISTANCE BETWEEN TWO CLOSE RATES.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SHAPE, AND WHAT IT REPLACED
 *
 * Both comparison panels used to draw two stacked bars per row: one for the
 * group where something went well, one for the group where it did not. Every
 * rate was on screen and every count was labelled, and the panels were still
 * slow to read, because the number they are SORTED BY was the one thing never
 * drawn. Finding the biggest lever meant subtracting 42 from 100, then 46 from
 * 83, five more times, and then ranking the seven answers you had worked out —
 * across fourteen bars carrying fourteen labels. [STATED — Moayad, chat
 * 2026-08-28: "i still feel like those sections are hard to understand at a
 * quick glance", after the earlier fixes to the same panels.]
 *
 * So the gap became the mark. One row, two dots on a shared 0–100% axis, and a
 * line between them whose LENGTH is the gap. The ranking is then a staircase
 * you read in one pass, and where the two rates actually sit is still on the
 * page — winning 100% against 42% is a different conversation from winning 58%
 * against 50%, and a chart of gaps alone cannot tell them apart.
 *
 * THE DOT CARRIES THE SAMPLE SIZE, which is the other thing that was hard to
 * see. Reading the room led the panel at +58 on NINE calls; its green dot is a
 * pinprick beside Digging deep's, which is thirty. Area, not radius, tracks the
 * count — scaling the radius exaggerates a big group by its square.
 *
 * A GAP SMALLER THAN ITS OWN SWING IS DRAWN, NOT HIDDEN. It renders as a dotted
 * line ending in a hollow dot, so it reads as unfinished at a glance rather
 * than needing a paragraph further down the page to explain itself.
 */

/**
 * Smallest and largest a dot may be drawn, in pixels. The floor keeps a
 * five-call group visible; the ceiling stops a seventy-call group swallowing
 * the line it sits on.
 */
const DOT_MIN = 7;
const DOT_MAX = 15;

/** A dot's diameter for `calls` calls, scaled so its AREA tracks the count. */
export function dotSize(calls: number): number {
  return Math.max(DOT_MIN, Math.min(DOT_MAX, Math.round(2 * Math.sqrt(calls) + 3)));
}

/**
 * The axis the rows are read against, drawn once above them.
 *
 * It shares the row's grid so the ticks land on the track rather than near it.
 * `gridTemplate` is passed rather than duplicated: two grids that must line up
 * and are declared separately drift the first time a column is resized.
 */
export function GapScale({ gridTemplate }: { gridTemplate: string }) {
  return (
    <div
      className="grid grid-cols-1 items-center gap-3.5 px-3.5 pb-1.5 font-mono text-[10px] text-zinc-400 sm:grid-cols-[var(--gap-grid)]"
      style={{ "--gap-grid": gridTemplate } as React.CSSProperties}
    >
      {/* The spacer columns only exist to hold the ticks over the track on a
          wide screen. Narrow, the track is a full-width row of its own and the
          ticks sit directly above it, so the spacers would push them off. */}
      <span className="hidden sm:block" />
      <span className="flex justify-between px-2">
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>100%</span>
      </span>
      <span className="hidden sm:block" />
    </div>
  );
}

export interface GapRowProps {
  /** What is being compared, e.g. a part of the call. */
  label: string;
  /** The two group sizes, said under the label. Omitted renders nothing. */
  sublabel?: string;
  /** Close rate on the group where it went well, 0–100. */
  goodRate: number;
  goodCalls: number;
  /** Close rate on the group where it did not, 0–100. */
  poorRate: number;
  poorCalls: number;
  /** The gap as the screen shows it — already rounded by the caller. */
  gap: number;
  /** How far one call landing the other way would move that gap. */
  swing: number;
  /** False when the gap is inside its own swing, so there is no pattern. */
  conclusive: boolean;
  /** Spelled out on hover, where there is room for the counts. */
  title: string;
  gridTemplate: string;
}

export function GapRow({
  label,
  sublabel,
  goodRate,
  goodCalls,
  poorRate,
  poorCalls,
  gap,
  swing,
  conclusive,
  title,
  gridTemplate,
}: GapRowProps) {
  // The line spans the two rates whichever way round they are. A worse group
  // that closes BETTER is a real reading — the panel says so rather than
  // rendering a negative width and disappearing.
  const lo = Math.min(goodRate, poorRate);
  const hi = Math.max(goodRate, poorRate);
  const goodIsLeft = goodRate < poorRate;

  // `--muted-foreground` is this app's zinc-400, and it is a token rather than
  // a Tailwind shade so it cannot quietly stop existing — a colour that does
  // not resolve renders as nothing here, with no error and no failing test.
  const GOOD = "var(--color-positive)";
  const POOR = "var(--muted-foreground)";

  return (
    /* TWO LAYOUTS, BECAUSE THE TRACK CANNOT BE SQUEEZED.
       Wide, the row is label · track · gap in one line. Narrow, those fixed
       168px and 132px columns leave the middle one nothing — measured at
       375px, the track computed to ZERO WIDTH and the dumbbell vanished with
       no error and nothing in the markup missing. So below `sm` the label and
       the gap share the first line and the track takes a full-width second
       one. The cells are placed explicitly rather than reordered in the DOM,
       so the reading order stays label, then chart, then figure. */
    <div
      className="grid grid-cols-[1fr_auto] items-center gap-x-3.5 gap-y-1.5 rounded-lg px-3.5 py-2 transition-colors hover:bg-white/[0.02] sm:grid-cols-[var(--gap-grid)]"
      style={{ "--gap-grid": gridTemplate } as React.CSSProperties}
      title={title}
    >
      <span className="col-start-1 row-start-1 min-w-0 text-[13px] text-zinc-300">
        <span className="block truncate">{label}</span>
        {sublabel && (
          <span className="block font-mono text-[11px] text-zinc-400">
            {sublabel}
          </span>
        )}
      </span>

      {/* The 8px inset is what keeps a dot sitting at 0% or 100% inside the
          row. Percentages resolve against this inner box, so the padding has
          to be on a wrapper rather than on the track itself. */}
      <span className="col-span-2 col-start-1 row-start-2 block px-2 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <span className="relative block h-6">
          <span className="absolute inset-x-0 top-1/2 h-px bg-white/[0.05]" />

          {conclusive ? (
            <span
              className="absolute top-1/2 -mt-[1.5px] h-[3px] rounded-sm"
              style={{
                left: `${lo}%`,
                width: `${hi - lo}%`,
                background: `linear-gradient(90deg, ${goodIsLeft ? GOOD : POOR}, ${goodIsLeft ? POOR : GOOD})`,
              }}
            />
          ) : (
            <span
              className="absolute top-1/2 border-t-[3px] border-dotted border-zinc-400/55"
              style={{ left: `${lo}%`, width: `${hi - lo}%` }}
            />
          )}

          <span
            className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-400"
            style={{
              left: `${poorRate}%`,
              width: dotSize(poorCalls),
              height: dotSize(poorCalls),
            }}
          />
          <span
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ${
              conclusive
                ? "bg-[var(--color-positive)]"
                : "border-2 border-zinc-400 bg-[var(--card)]"
            }`}
            style={{
              left: `${goodRate}%`,
              width: dotSize(goodCalls),
              height: dotSize(goodCalls),
            }}
          />
        </span>
      </span>

      <span className="col-start-2 row-start-1 text-right sm:col-start-3">
        <span
          className={`block font-mono text-[16px] font-medium tabular-nums ${
            conclusive ? "text-[var(--color-positive)]" : "text-zinc-400"
          }`}
        >
          {gap > 0 ? `+${gap}` : `${gap}`}
        </span>
        <span className="block text-[11px] leading-tight text-zinc-400">
          {swing === 0 ? "one call moves it <1" : `one call moves it ${swing}`}
          {!conclusive && " — too close"}
        </span>
      </span>
    </div>
  );
}

/**
 * The two dots explained, once, under the rows.
 *
 * `goodLabel` differs between the panels — one is comparing how a part of the
 * call went, the other which half of the leads it was. Naming them "good" and
 * "bad" in both places would make the leads panel read as a judgement on the
 * prospect rather than on the traffic.
 */
export function GapLegend({
  goodLabel,
  poorLabel,
  note,
}: {
  goodLabel: string;
  poorLabel: string;
  note?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-zinc-400">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-zinc-400" />
        {poorLabel}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-[var(--color-positive)]" />
        {goodLabel}
      </span>
      <span>
        A bigger dot is more calls behind it. A dotted line is a gap one call
        could erase.
      </span>
      {note && <span className="ml-auto">{note}</span>}
    </div>
  );
}
