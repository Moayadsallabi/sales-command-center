"use client";

import { CallRecord } from "@/lib/types";
import { closerLeaderboard, GOOD_CALL_SCORE, MIN_CALLS_PER_CLOSER, POOR_SCORE } from "@/lib/stats";
import { LEAD_MAX } from "@/lib/lead-quality";
import { formatReporting } from "@/lib/money";
import { Trophy, TrendingDown, TrendingUp } from "lucide-react";
import { Panel, PanelHeader } from "./panel";

/** Leaderboard figures are cross-call totals, so already in one currency. */
const currency = (value: number) => formatReporting(value);

/** Gold at GOOD_SCORE and above, amber down to POOR_SCORE, red below it. The
    comment here used to say "same thresholds everywhere" and it was not true —
    the call table's copy started at 8. They read the constants now. */
function scoreColor(score: number | null): string {
  if (score == null) return "text-zinc-400";
  if (score >= GOOD_CALL_SCORE) return "text-gold-400";
  if (score >= POOR_SCORE) return "text-amber-400";
  return "text-[var(--color-negative)]";
}

/** Movement under this is measurement wobble rather than a real change. */
const TREND_NOISE = 0.3;

function Trend({ value }: { value: number | null }) {
  if (value == null) return <span className="text-zinc-500">—</span>;
  if (Math.abs(value) < TREND_NOISE) return <span className="text-zinc-400">flat</span>;
  const better = value > 0;
  const Icon = better ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center justify-end gap-1 ${
        better
        ? "text-[var(--color-positive)]"
        : "text-[var(--color-negative)]"
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
  order = 0,
}: {
  calls: CallRecord[];
  previousCalls: CallRecord[];
  selected: string | null;
  onSelect: (closer: string | null) => void;
  order?: number;
}) {
  const rows = closerLeaderboard(calls, previousCalls);

  return (
    <Panel order={order} padded={false} className="overflow-hidden">
      <div className="p-5 pb-0">
        <PanelHeader
          icon={Trophy}
          title="Closers"
          subtitle="Click a row to narrow everything below to that person."
          info={
            <>
              <p>
                Lead quality sits next to close rate on purpose. A lower close
                rate against lower-quality leads is a different finding from a
                lower close rate against the same leads as everyone else, and
                only one of the two is a coaching conversation.
              </p>
              <p>
                Trend is the change in average call score against the previous
                period. Anything inside {TREND_NOISE} of zero reads as flat,
                because below that it is measurement wobble rather than
                movement.
              </p>
              <p>
                A closer needs {MIN_CALLS_PER_CLOSER} scored calls before a
                weakest part of their call is named — under that it is one bad
                call, not a habit.
              </p>
            </>
          }
          right={
            selected ? (
              <button
                onClick={() => onSelect(null)}
                className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
              >
                Show everyone
              </button>
            ) : null
          }
        />
      </div>

      {rows.length === 0 ? (
        <div className="px-5 pb-6 t-body text-zinc-300">No calls in this range.</div>
      ) : (
        <div className="scroll-x">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-white/[0.06]">
                {/* Alignment is declared per column rather than by index, so
                    adding one does not silently shift another's alignment. */}
                {[
                  { label: "Closer", align: "left" },
                  { label: "Calls", align: "right" },
                  { label: "Taken", align: "right" },
                  { label: "Closed", align: "right" },
                  { label: "Close rate", align: "right" },
                  { label: "Cash", align: "right" },
                  { label: "Avg score", align: "right" },
                  // Sits next to the close rate on purpose: a lower close rate
                  // against lower-quality leads is a different finding from a
                  // lower close rate against the same leads as everyone else.
                  { label: "Lead quality", align: "right" },
                  { label: "Trend", align: "right" },
                  { label: "Weakest part of their call", align: "left" },
                ].map(({ label, align }) => (
                  <th
                    key={label}
                    className={`text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-400 px-5 py-3 whitespace-nowrap ${
                      align === "left" ? "text-left" : "text-right"
                    }`}
                  >
                    {label}
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
                    <td
                      className="px-5 py-3 text-right font-mono tabular-nums text-zinc-400"
                      title={
                        row.avgLeadScore == null
                          ? "None of these calls has a lead assessment yet"
                          : `Average across the ${row.leadScoredCalls} of their calls with a lead score`
                      }
                    >
                      {row.avgLeadScore == null ? (
                        "—"
                      ) : (
                        <>
                          {Math.round(row.avgLeadScore)}
                          <span className="text-zinc-400">/{LEAD_MAX}</span>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-[13px] tabular-nums">
                      <Trend value={row.trend} />
                    </td>
                    <td className="px-5 py-3 whitespace-nowrap text-zinc-500 text-[13px]">
                      {row.weakest ? (
                        <>
                          {row.weakest.dimension.plainName}{" "}
                          <span className="font-mono tabular-nums text-zinc-400">
                            {row.weakest.score.toFixed(1)}
                          </span>
                        </>
                      ) : (
                        // Blank for two different reasons, and they want
                        // different responses: nothing scored yet, or scored
                        // but too few to call anything a habit.
                        <span className="text-zinc-500">
                          {row.scoredCalls === 0
                            ? "not scored yet"
                            : `${row.scoredCalls} of ${MIN_CALLS_PER_CLOSER} scored calls`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
