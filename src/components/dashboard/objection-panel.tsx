"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import { ObjectionStat, objectionStats } from "@/lib/stats";
import { MessageSquareWarning } from "lucide-react";

/**
 * How often each objection comes up, and what the close rate does when it does.
 *
 * The per-call scorecard already says whether an objection was handled well.
 * This says something the call-level view cannot: an objection appearing on
 * half of all calls is being manufactured upstream — by the price, the pitch or
 * the targeting — and drilling closers on handling it treats the symptom. The
 * frequency column is the offer problem; the close-rate column is the cost.
 */
export function ObjectionPanel({ calls }: { calls: CallRecord[] }) {
  const result = objectionStats(calls);
  const base = Math.round(result.baseCloseRate);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <div className="mb-1 flex items-center gap-2">
        <MessageSquareWarning className="h-3.5 w-3.5 text-gold-500" strokeWidth={1.5} />
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          What people push back on
        </h3>
      </div>
      <p className="mb-5 max-w-[70ch] text-[12px] leading-relaxed text-zinc-600">
        Every objection voiced across your calls, most common first, with how
        often those calls still closed. Something that shows up on most calls is
        coming from the offer or the traffic, not from the closers.
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
                before the pattern is worth reading. You have {result.assessed}.
              </>
            ) : (
              <>No objections have been recorded on these calls yet.</>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {result.stats.map((stat) => (
            <ObjectionRow key={stat.name} stat={stat} base={base} />
          ))}

          <div className="flex items-center gap-4 pt-2 text-[10px] text-zinc-600">
            {/* "Reviewed for objections" rather than "assessed" — the lead
                panel uses a stricter test for its own count, and the two
                numbers sitting under the same word looked like a bug. */}
            <span>
              Across {result.assessed}{" "}
              {result.assessed === 1 ? "call" : "calls"} reviewed for objections,
              closing {base}% overall
            </span>
            <span className="ml-auto">
              One call can raise more than one, so these do not add to 100%.
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function ObjectionRow({ stat, base }: { stat: ObjectionStat; base: number }) {
  const frequency = Math.round(stat.frequency);
  const rate = Math.round(stat.closeRate);
  const delta = rate - base;

  // Under five calls a close rate is a coin toss, so it is shown greyed with
  // the count rather than stated as a rate anyone should act on.
  const thin = stat.calls < 5;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5">
      <span className="w-[140px] shrink-0 truncate text-[13px] text-zinc-300">
        {stat.name}
        {stat.belief && (
          <span className="block text-[11px] text-zinc-600">
            {stat.belief} belief
          </span>
        )}
      </span>

      <div className="flex-1">
        <div className="h-5 overflow-hidden rounded bg-white/[0.03]">
          <div
            className="flex h-full items-center rounded bg-zinc-600/60"
            style={{ width: `${Math.max(frequency, 1)}%` }}
          >
            <span
              className="whitespace-nowrap pl-2 text-[10px] text-zinc-300/80"
              title={`Raised on ${stat.calls} of the assessed calls`}
            >
              {stat.calls} {stat.calls === 1 ? "call" : "calls"}
            </span>
          </div>
        </div>
        {stat.decided > 0 && (
          <p className="mt-1 text-[10px] text-zinc-600">
            decided {stat.decided} of them
          </p>
        )}
      </div>

      <span className="w-[92px] shrink-0 text-right">
        {thin ? (
          <span className="font-mono text-[12px] tabular-nums text-zinc-600">
            too few
          </span>
        ) : (
          <>
            <span className="font-mono text-[13px] tabular-nums text-zinc-300">
              {rate}%
            </span>
            <span
              className={`block text-[10px] tabular-nums ${
                delta < 0 ? "text-red-400/80" : "text-emerald-400/80"
              }`}
              title={`Against ${base}% across all assessed calls`}
            >
              {delta >= 0 ? "+" : ""}
              {delta} vs all
            </span>
          </>
        )}
      </span>
    </div>
  );
}
