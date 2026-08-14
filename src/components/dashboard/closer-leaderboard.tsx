"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import { closerLeaderboard } from "@/lib/stats";
import { formatReporting } from "@/lib/money";
import { Trophy, TrendingDown, TrendingUp } from "lucide-react";

/** Leaderboard figures are cross-call totals, so already in one currency. */
const currency = (value: number) => formatReporting(value);

/** Gold above 7.5, amber 6 to 7.5, red below 6 — same thresholds everywhere. */
function scoreColor(score: number | null): string {
  if (score == null) return "text-zinc-600";
  if (score >= 7.5) return "text-gold-400";
  if (score >= 6) return "text-amber-400";
  return "text-red-400";
}

/** Movement under this is measurement wobble rather than a real change. */
const TREND_NOISE = 0.3;

function Trend({ value }: { value: number | null }) {
  if (value == null) return <span className="text-zinc-700">—</span>;
  if (Math.abs(value) < TREND_NOISE) return <span className="text-zinc-600">flat</span>;
  const better = value > 0;
  const Icon = better ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center justify-end gap-1 ${
        better ? "text-emerald-400" : "text-red-400"
      }`}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {better ? "+" : ""}
      {value.toFixed(1)}
    </span>
  );
}

export function CloserLeaderboard({
  calls,
  previousCalls,
  selected,
  onSelect,
}: {
  calls: CallRecord[];
  previousCalls: CallRecord[];
  selected: string | null;
  onSelect: (closer: string | null) => void;
}) {
  const rows = closerLeaderboard(calls, previousCalls);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.55, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card overflow-hidden"
    >
      <div className="flex items-center justify-between p-5 pb-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-3.5 h-3.5 text-gold-500" strokeWidth={1.5} />
          <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            Closers
          </h3>
        </div>
        {selected && (
          <button
            onClick={() => onSelect(null)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            Show everyone
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="px-5 pb-6 text-sm text-zinc-600">No calls in this range.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {[
                  "Closer",
                  "Calls",
                  "Taken",
                  "Closed",
                  "Close rate",
                  "On call",
                  "Cash",
                  "Avg score",
                  "Trend",
                  "Weakest part of their call",
                ].map((heading, i) => (
                    <th
                      key={heading}
                      className={`text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-600 px-5 py-3 whitespace-nowrap ${
                        i === 0 || i === 8 ? "text-left" : "text-right"
                      }`}
                    >
                      {heading}
                    </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isSelected = selected === row.closer;
                return (
                  <tr
                    key={row.closer}
                    onClick={() => onSelect(isSelected ? null : row.closer)}
                    className={`border-b border-white/[0.03] cursor-pointer transition-colors ${
                      isSelected ? "bg-gold-500/[0.06]" : "hover:bg-white/[0.02]"
                    }`}
                  >
                    <td className="px-5 py-3 whitespace-nowrap font-medium text-zinc-200">
                      {row.closer}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-zinc-400">
                      {row.calls}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-zinc-400">
                      {row.taken}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-zinc-400">
                      {row.customers}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-zinc-200">
                      {row.closeRate == null ? "—" : `${Math.round(row.closeRate)}%`}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-zinc-400">
                      {currency(row.cashOnCall)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-gold-400">
                      {currency(row.cashCollected)}
                    </td>
                    <td
                      className={`px-5 py-3 text-right font-mono tabular-nums font-medium ${scoreColor(
                        row.avgScore
                      )}`}
                    >
                      {row.avgScore == null ? "—" : row.avgScore.toFixed(1)}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-[12px] tabular-nums">
                      <Trend value={row.trend} />
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-zinc-500 text-[13px]">
                      {row.weakest ? (
                        <>
                          {row.weakest.dimension.plainName}{" "}
                          <span className="font-mono tabular-nums text-zinc-600">
                            {row.weakest.score.toFixed(1)}
                          </span>
                        </>
                      ) : (
                        <span className="text-zinc-700">not scored yet</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </motion.div>
  );
}
