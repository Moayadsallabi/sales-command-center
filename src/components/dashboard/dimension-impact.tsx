"use client";

import { CallRecord } from "@/lib/types";
import { DimensionImpact as Impact, dimensionImpact } from "@/lib/stats";
import { GOOD_SCORE } from "@/lib/dimensions";
import { Coins } from "lucide-react";
import { Panel, PanelHeader } from "./panel";

/**
 * Close rate when each part of the call went well against when it did not,
 * measured on this account's own calls. Everything else on the dashboard
 * asserts that these scores matter; this is the panel that shows it.
 *
 * The two rates share one axis so the overhang between them *is* the gap —
 * side-by-side bars in separate tracks cannot be compared by eye. Each bar is
 * labelled with the calls behind it rather than a bare percentage, because on
 * buckets of six or seven a percentage reads far more precisely than it
 * deserves to.
 */
export function DimensionImpact({
  calls,
  order = 0,
}: {
  calls: CallRecord[];
  order?: number;
}) {
  const result = dimensionImpact(calls);
  const conclusive = result.impacts.filter((i) => i.conclusive);
  const inconclusive = result.impacts.filter((i) => !i.conclusive);

  return (
    <Panel order={order}>
      <PanelHeader
        icon={Coins}
        title="Which parts of the call move your close rate"
        subtitle="How often you closed when each part went well, against when it did not."
        info={
          <>
            <p>
              Each row splits your scored calls in two — the calls where this
              part scored {GOOD_SCORE} or better, and the calls where it scored
              below {GOOD_SCORE} — then shows how often you closed in each
              group.
            </p>
            <p>
              The length of each bar is that group&rsquo;s close rate, and the
              number on the right is how far apart the two rates are. Both bars
              run from the same origin across the same width, so the gold
              bar&rsquo;s overhang past the grey one is the gap itself.
            </p>
            <p>
              A wide gap is a pattern worth drilling, not proof: a strong
              prospect lifts the score and the close together.
            </p>
          </>
        }
      />

      {!result.ready ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
          <p className="text-[13px] text-zinc-400">
            {result.callsShort > 0 ? (
              <>
                Needs{" "}
                <span className="font-medium text-zinc-200">
                  {result.callsShort} more scored{" "}
                  {result.callsShort === 1 ? "call" : "calls"}
                </span>{" "}
                before these numbers mean anything. You have {result.scored}.
              </>
            ) : (
              <>
                Not enough spread yet — a comparison needs calls on both sides of
                each score, and right now they are bunched together.
              </>
            )}
          </p>
          <p className="mt-1.5 text-[11px] text-zinc-400">
            Close rates on a handful of calls swing wildly, so this stays hidden
            rather than showing you noise.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {conclusive.length > 0 && (
            <div className="space-y-2">
              {conclusive.map((impact) => (
                <ImpactRow key={impact.dimension.key} impact={impact} />
              ))}
            </div>
          )}

          {/* NOT DIMMED TO HALF ANY MORE.
              These rows were wrapped in `opacity-50`, on top of text that was
              already low-contrast, and the result was three of four rows
              reading as noise — indistinguishable from disabled, or loading,
              or a rendering fault. A state that means something has to be
              said, not faded: the heading names it, and the rows themselves
              stay legible so the numbers behind the verdict can be checked. */}
          {inconclusive.length > 0 && (
            <div>
              <p className="mb-2 t-body text-zinc-400">
                <span className="font-medium text-zinc-200">
                  {conclusive.length > 0
                    ? "Too close to call"
                    : "Nothing separates yet"}
                </span>{" "}
                — the gap here is smaller than the swing from a single call
                landing the other way, so there is no pattern to read.
              </p>
              <div className="space-y-2">
                {inconclusive.map((impact) => (
                  <ImpactRow key={impact.dimension.key} impact={impact} />
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-zinc-400">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-gold-500/80" />
              Scored {GOOD_SCORE} or better
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-zinc-500/45" />
              Scored below {GOOD_SCORE}
            </span>
            <span className="ml-auto">
              Only parts with enough calls on both sides are shown.
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ImpactRow({ impact }: { impact: Impact }) {
  // Rounded once, so the two rates and the gap between them always agree.
  const good = Math.round(impact.goodCloseRate);
  const poor = Math.round(impact.poorCloseRate);
  const gap = good - poor;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <span
        className="shrink-0 truncate text-[13px] font-medium text-zinc-200 sm:w-[140px] sm:font-normal sm:text-zinc-300"
        title={impact.dimension.plainQuestion}
      >
        {impact.dimension.plainName}
      </span>

      {/* One axis, one origin. Both bars run 0–100% of the same width, so the
          gold bar's overhang past the grey one is the gap, at a glance. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Bar
          width={good}
          className="bg-gold-500/80"
          // WAS `text-gold-200/70`, WHICH WAS NOT A COLOUR.
          // The gold ramp started at 300, so Tailwind emitted no rule for it
          // and the label inherited the page's near-white foreground — white
          // text on a gold bar, where dark-on-gold was intended. The shade
          // exists now, but the label uses the dedicated ink token instead:
          // what this needs is guaranteed contrast against gold, which is a
          // different job from being a light step on the ramp.
          labelClassName="text-[var(--color-gold-ink)] font-medium"
          label={`${good}% closed — ${impact.goodCloses} of ${impact.goodCalls}`}
          title={`${impact.goodCloses} of the ${impact.goodCalls} calls where this scored ${GOOD_SCORE} or better ended as a customer`}
        />
        <Bar
          width={poor}
          // zinc-500 text on a zinc-600/60 fill measured about 1.1:1 — the
          // label was legible only if you already knew what it said. Lighter
          // text, and enough fill behind it to sit on.
          className="bg-zinc-500/45"
          labelClassName="text-zinc-100"
          label={`${poor}% closed — ${impact.poorCloses} of ${impact.poorCalls}`}
          title={`${impact.poorCloses} of the ${impact.poorCalls} calls where this scored below ${GOOD_SCORE} ended as a customer`}
        />
      </div>

      <span
        className="flex shrink-0 items-baseline justify-between gap-2 text-right sm:w-[104px] sm:block"
        title={
          impact.conclusive
            ? `Closed ${good}% of the time when this went well against ${poor}% when it did not`
            : `${good}% against ${poor}%, a gap of ${gap} — smaller than the ${Math.round(impact.swing)} one call landing the other way would move it`
        }
      >
        <span
          className={`font-mono text-[15px] font-medium tabular-nums sm:block ${
            impact.conclusive ? "text-gold-400" : "text-zinc-300"
          }`}
        >
          {gap > 0 ? `+${gap}` : `${gap}`}
        </span>
        <span className="text-[11px] leading-tight text-zinc-400 sm:block">
          {good}% vs {poor}%
        </span>
      </span>
    </div>
  );
}

/**
 * A bar whose label sits inside it when there is room, and just past its end
 * when there is not.
 *
 * The label used to be pinned 8px from the left of the TRACK, whatever the bar
 * was doing. On a 20% bar with a 120px label most of the text hung over the
 * empty part of the track — which is why colouring it for the fill it was
 * supposedly sitting on could never work, in either direction. Dark ink on
 * gold is unreadable off the end of a gold bar, and light text on the track is
 * unreadable on top of one.
 *
 * So the label moves with the bar and takes its colour from where it lands.
 */
const LABEL_FITS_INSIDE = 45;

function Bar({
  width,
  className,
  label,
  labelClassName,
  title,
}: {
  width: number;
  className: string;
  label: string;
  /** Applied only when the label ends up on top of the fill. */
  labelClassName: string;
  title: string;
}) {
  const inside = width >= LABEL_FITS_INSIDE;

  return (
    <div className="relative h-5 rounded bg-white/[0.03]" title={title}>
      <div
        className={`absolute inset-y-0 left-0 rounded ${className}`}
        style={{ width: `${width}%` }}
      />
      {/* ALWAYS AT THE END OF THE BAR, INSIDE IT OR JUST PAST IT.
          Anchoring the label to the left of the TRACK put it in a different
          place on every row. Anchored to the bar, the eye reads down a ragged
          edge that means something — where each bar stops. */}
      <span
        className={`absolute inset-y-0 flex items-center justify-end whitespace-nowrap font-mono text-[11px] tabular-nums ${
          inside ? labelClassName : "text-zinc-200"
        }`}
        style={
          inside
            ? { left: 0, width: `${width}%`, paddingRight: 8 }
            : { left: `calc(${width}% + 8px)` }
        }
      >
        {label}
      </span>
    </div>
  );
}
