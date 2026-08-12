"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import { DIMENSIONS } from "@/lib/dimensions";
import { dimensionAverages, recurringWeakness } from "@/lib/stats";
import { AlertTriangle } from "lucide-react";

function barColor(score: number): string {
  if (score >= 7.5) return "#d4af37";
  if (score >= 6) return "#f59e0b";
  return "#ef4444";
}

/**
 * The eight dimension averages as bars. When a closer is selected, the team
 * average shows behind their bar so the comparison is visible rather than
 * something the reader has to hold in their head.
 */
export function DimensionProfile({
  calls,
  allCalls,
  closer,
}: {
  calls: CallRecord[];
  allCalls: CallRecord[];
  closer: string | null;
}) {
  const averages = dimensionAverages(calls);
  const teamAverages = dimensionAverages(allCalls);
  const pattern = recurringWeakness(calls);
  const scoredCount = calls.filter((c) =>
    DIMENSIONS.some((d) => c.scores[d.key] != null)
  ).length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.65, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          {closer ? `${closer} — dimension profile` : "Dimension profile"}
        </h3>
        <span className="font-mono text-[11px] text-zinc-600 tabular-nums">
          {scoredCount} scored {scoredCount === 1 ? "call" : "calls"}
        </span>
      </div>

      {scoredCount === 0 ? (
        <p className="text-sm text-zinc-600">
          No scored calls in this range. Calls recorded before the scorecard was installed
          have no dimension scores.
        </p>
      ) : (
        <>
          <div className="space-y-2.5">
            {DIMENSIONS.map((dimension, i) => {
              const score = averages[dimension.key];
              const team = teamAverages[dimension.key];
              return (
                <div key={dimension.key} className="flex items-center gap-3">
                  <span
                    className="w-[150px] shrink-0 text-[12px] text-zinc-400 truncate"
                    title={dimension.question}
                  >
                    {dimension.name}
                  </span>
                  <div className="relative flex-1 h-5 rounded bg-white/[0.03] overflow-hidden">
                    {closer && team != null && (
                      <div
                        className="absolute inset-y-0 w-px bg-white/25 z-10"
                        style={{ left: `${(team / 10) * 100}%` }}
                        title={`Team average ${team.toFixed(1)}`}
                      />
                    )}
                    {score != null && (
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(score / 10) * 100}%` }}
                        transition={{ delay: 0.7 + i * 0.04, duration: 0.5, ease: "easeOut" }}
                        className="h-full rounded"
                        style={{ background: barColor(score), opacity: 0.85 }}
                      />
                    )}
                  </div>
                  <span
                    className="w-9 shrink-0 text-right font-mono text-[12px] tabular-nums"
                    style={{ color: score == null ? "#52525b" : barColor(score) }}
                  >
                    {score == null ? "—" : score.toFixed(1)}
                  </span>
                </div>
              );
            })}
          </div>

          {closer && (
            <p className="mt-4 text-[10px] text-zinc-600">
              The vertical line on each bar is the team average.
            </p>
          )}

          {pattern && (
            <div className="mt-5 flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] p-3.5">
              <AlertTriangle
                className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0"
                strokeWidth={1.5}
              />
              <p className="text-[12px] leading-relaxed text-zinc-300">
                <span className="font-medium text-amber-300">Pattern:</span>{" "}
                {pattern.name} scored below 6 on {pattern.callsBelowSix} of the{" "}
                {scoredCount} scored calls here ({Math.round(pattern.share * 100)}%). One low
                score is a bad call. This many is a habit.
              </p>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
