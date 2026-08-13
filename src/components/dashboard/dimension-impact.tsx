"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import { dimensionImpact } from "@/lib/stats";
import { GOOD_SCORE } from "@/lib/dimensions";
import { Coins } from "lucide-react";

/**
 * Close rate when each part of the call went well against when it did not,
 * measured on this account's own calls. Everything else on the dashboard
 * asserts that these scores matter; this is the panel that shows it.
 */
export function DimensionImpact({ calls }: { calls: CallRecord[] }) {
  const result = dimensionImpact(calls);

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
          What each part of the call is worth
        </h3>
      </div>
      <p className="mb-5 text-[12px] text-zinc-600">
        How often you close when this goes well, against how often you close when it
        does not. Measured on your own calls. A strong prospect lifts both the score
        and the close, so read these as patterns worth drilling — not promises.
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
        <div className="space-y-2">
          {result.impacts.map((impact) => {
            // Both bars and the gap are rounded off the same two numbers, or a
            // row reads as broken arithmetic: 46.2 and 28.6 render as 46 and 29
            // but their raw gap of 17.6 rounds to 18. Ordering still uses the
            // full-precision gap from stats.
            const good = Math.round(impact.goodCloseRate);
            const poor = Math.round(impact.poorCloseRate);
            const gap = good - poor;
            return (
            <div
              key={impact.dimension.key}
              className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5"
            >
              <span
                className="w-[140px] shrink-0 truncate text-[13px] text-zinc-300"
                title={impact.dimension.plainQuestion}
              >
                {impact.dimension.plainName}
              </span>

              <div className="flex flex-1 items-center gap-2">
                <div className="relative h-6 flex-1 overflow-hidden rounded bg-white/[0.03]">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-gold-500/70"
                    style={{ width: `${impact.goodCloseRate}%` }}
                  />
                  <span className="absolute inset-y-0 left-2 flex items-center font-mono text-[11px] tabular-nums text-zinc-100">
                    {good}%
                  </span>
                </div>
                <div className="relative h-6 flex-1 overflow-hidden rounded bg-white/[0.03]">
                  <div
                    className="absolute inset-y-0 left-0 rounded bg-zinc-600/60"
                    style={{ width: `${impact.poorCloseRate}%` }}
                  />
                  <span className="absolute inset-y-0 left-2 flex items-center font-mono text-[11px] tabular-nums text-zinc-400">
                    {poor}%
                  </span>
                </div>
              </div>

              <span
                className={`w-20 shrink-0 text-right font-mono text-[12px] font-medium tabular-nums ${
                  gap > 0 ? "text-gold-400" : "text-zinc-600"
                }`}
              >
                {gap > 0 ? `+${gap} pts` : "no effect"}
              </span>
            </div>
            );
          })}

          <div className="flex items-center gap-4 pt-2 text-[10px] text-zinc-600">
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
