"use client";

import { motion } from "framer-motion";
import { CallRecord, OUTCOME_COLORS } from "@/lib/types";
import { collectedToDate, formatMoney, formatReporting } from "@/lib/money";
import { wasSettledByPayment } from "@/lib/settle";
import { ExternalLink } from "lucide-react";

export function CallTable({
  calls,
  onSelect,
}: {
  calls: CallRecord[];
  onSelect: (call: CallRecord) => void;
}) {
  const sorted = [...calls].sort((a, b) => {
    if (!a.call_date) return 1;
    if (!b.call_date) return -1;
    return b.call_date.localeCompare(a.call_date);
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.0, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card overflow-hidden"
    >
      <div className="p-5 pb-0">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500 mb-1">
          All Calls
        </h3>
        <p className="text-[10px] text-zinc-600 mb-4">
          Click a row to open its scorecard.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {[
                "Name",
                "Closer",
                "Date",
                "Outcome",
                "Cash Collected",
                "Revenue",
                "Source",
                "Score",
              ].map((h) => (
                <th
                  key={h}
                  className="text-left text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-600 px-5 py-3 whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((call) => (
              <tr
                key={call.id}
                onClick={() => onSelect(call)}
                className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors cursor-pointer"
              >
                <td className="px-5 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-200">
                      {call.name || "Unknown"}
                    </span>
                    {call.recording_url && (
                      <a
                        href={call.recording_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-zinc-600 hover:text-gold-400 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 whitespace-nowrap text-xs text-zinc-400">
                  {call.closer ?? <span className="text-zinc-700">—</span>}
                </td>
                <td className="px-5 py-3 whitespace-nowrap font-mono text-xs text-zinc-500 tabular-nums">
                  {call.call_date
                    ? new Date(call.call_date + "T00:00:00").toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    : "—"}
                </td>
                <td className="px-5 py-3 whitespace-nowrap">
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full"
                    style={{
                      color: OUTCOME_COLORS[call.outcome ?? ""] ?? "#9ca3af",
                      background: `${OUTCOME_COLORS[call.outcome ?? ""] ?? "#9ca3af"}15`,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background:
                          OUTCOME_COLORS[call.outcome ?? ""] ?? "#9ca3af",
                      }}
                    />
                    {call.outcome ?? "—"}
                  </span>
                  {/* This row is being counted as a win because the processor
                      says it was paid for, not because anyone marked it one.
                      Saying so on the row is the point: a closer whose number
                      moved can see exactly which call moved it, and what the
                      tracker still says. The real fix is correcting the row in
                      Notion, which this does not do. */}
                  {wasSettledByPayment(call) && (
                    <span
                      className="ml-2 text-[10px] text-zinc-500 whitespace-nowrap"
                      title={`Recorded as "${call.recorded_outcome}" on the day. Counted as a close because ${formatReporting(call.paid_total ?? 0)} was received. Correct the row in Notion to clear this.`}
                    >
                      was {call.recorded_outcome} · paid
                    </span>
                  )}
                </td>
                {/* Shown in the deal's own currency — never converted, so the
                    row always matches the contract. */}
                <td className="px-5 py-3 whitespace-nowrap font-mono text-xs tabular-nums">
                  {collectedToDate(call) ? (
                    <span className="text-gold-400">
                      {formatMoney(collectedToDate(call), call.currency)}
                      {call.outstanding ? (
                        <span className="ml-1 text-[10px] text-zinc-500">
                          +{formatMoney(call.outstanding, call.currency)} due
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-zinc-700">—</span>
                  )}
                </td>
                <td className="px-5 py-3 whitespace-nowrap font-mono text-xs tabular-nums">
                  {call.price_closed ? (
                    <span className="text-gold-400/50">
                      {formatMoney(call.price_closed, call.currency)}
                    </span>
                  ) : (
                    <span className="text-zinc-700">—</span>
                  )}
                </td>
                <td className="px-5 py-3 whitespace-nowrap text-xs text-zinc-500">
                  {call.lead_source ?? "—"}
                </td>
                <td className="px-5 py-3 whitespace-nowrap">
                  {call.quality_score != null ? (
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${(call.quality_score / 10) * 100}%`,
                            background:
                              call.quality_score >= 8
                                ? "#d4af37"
                                : call.quality_score >= 6
                                ? "#f59e0b"
                                : "#ef4444",
                          }}
                        />
                      </div>
                      <span className="font-mono text-xs text-zinc-500 tabular-nums">
                        {call.quality_score}
                      </span>
                    </div>
                  ) : (
                    <span className="text-zinc-700">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}
