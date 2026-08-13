"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import { DimensionImpact as Impact, dimensionImpact } from "@/lib/stats";
import { GOOD_SCORE } from "@/lib/dimensions";
import { Coins } from "lucide-react";

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
export function DimensionImpact({ calls }: { calls: CallRecord[] }) {
  const result = dimensionImpact(calls);
  const conclusive = result.impacts.filter((i) => i.conclusive);
  const inconclusive = result.impacts.filter((i) => !i.conclusive);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.7, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <div className="mb-1 flex items-center gap-2">
        <Coins className="h-3.5 w-3.5 text-gold-500" strokeWidth={1.5} />
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          Which parts of the call move your close rate
        </h3>
      </div>
      <p className="mb-5 max-w-[70ch] text-[12px] leading-relaxed text-zinc-600">
        Each row splits your scored calls in two — the calls where this part
        scored {GOOD_SCORE} or better, and the calls where it scored below{" "}
        {GOOD_SCORE} — then shows how often you closed in each group. A wide gap
        is a pattern worth drilling, not proof: a strong prospect lifts the score
        and the close together.
      </p>

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
          <p className="mt-1.5 text-[11px] text-zinc-600">
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

          {inconclusive.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] text-zinc-600">
                {conclusive.length > 0 ? "Too close to call" : "Nothing separates yet"} — the
                gap here is smaller than the swing from a single call landing the
                other way, so there is no pattern to read.
              </p>
              <div className="space-y-2 opacity-50">
                {inconclusive.map((impact) => (
                  <ImpactRow key={impact.dimension.key} impact={impact} />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 pt-1 text-[10px] text-zinc-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-gold-500/70" />
              Scored {GOOD_SCORE} or better
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-sm bg-zinc-600/60" />
              Scored below {GOOD_SCORE}
            </span>
            <span className="ml-auto">
              Only parts with enough calls on both sides are shown.
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function ImpactRow({ impact }: { impact: Impact }) {
  // Rounded once, so the two rates and the gap between them always agree.
  const good = Math.round(impact.goodCloseRate);
  const poor = Math.round(impact.poorCloseRate);
  const gap = good - poor;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5">
      <span
        className="w-[140px] shrink-0 truncate text-[13px] text-zinc-300"
        title={impact.dimension.plainQuestion}
      >
        {impact.dimension.plainName}
      </span>

      {/* One axis, one origin. Both bars run 0–100% of the same width, so the
          gold bar's overhang past the grey one is the gap, at a glance. */}
      <div className="flex flex-1 flex-col gap-1">
        <Bar
          width={good}
          className="bg-gold-500/70"
          label={`${impact.goodCloses} of ${impact.goodCalls} closed`}
          labelClassName="text-gold-200/70"
          title={`${impact.goodCloses} of the ${impact.goodCalls} calls where this scored ${GOOD_SCORE} or better ended as a customer`}
        />
        <Bar
          width={poor}
          className="bg-zinc-600/60"
          label={`${impact.poorCloses} of ${impact.poorCalls} closed`}
          labelClassName="text-zinc-500"
          title={`${impact.poorCloses} of the ${impact.poorCalls} calls where this scored below ${GOOD_SCORE} ended as a customer`}
        />
      </div>

      <span
        className={`w-[88px] shrink-0 text-right font-mono text-[12px] font-medium tabular-nums ${
          impact.conclusive ? "text-gold-400" : "text-zinc-600"
        }`}
        title={
          impact.conclusive
            ? `${gap} percentage points between the two close rates`
            : `A gap of ${gap} points, against ${Math.round(impact.swing)} points of swing from one call`
        }
      >
        {impact.conclusive ? `+${gap} pts` : `${gap} pts`}
      </span>
    </div>
  );
}

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
  labelClassName: string;
  title: string;
}) {
  return (
    <div className="relative h-5 overflow-hidden rounded bg-white/[0.03]" title={title}>
      <div
        className={`absolute inset-y-0 left-0 rounded ${className}`}
        style={{ width: `${width}%` }}
      />
      <span
        className={`absolute inset-y-0 left-2 flex items-center font-mono text-[10px] tabular-nums ${labelClassName}`}
      >
        {label}
      </span>
    </div>
  );
}
