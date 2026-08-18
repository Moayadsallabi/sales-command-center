"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import {
  followUps,
  FOLLOW_UP_COLD_DAYS,
  FOLLOW_UP_STALE_DAYS,
} from "@/lib/follow-ups";
import { formatMoney, formatReporting } from "@/lib/money";
import { PhoneForwarded, ExternalLink } from "lucide-react";

/** How many rows before the list stops being a list and becomes a wall. */
const SHOWN = 15;

/**
 * The deals still open, oldest first.
 *
 * Every other panel here reports on calls that are finished. This one is the
 * only thing on the page that is a job rather than a number: a BAMFAM is a
 * prospect who said speak to me again, and the row recording that never
 * changes, so on day fifty it still reads exactly as it did on day two.
 */
export function FollowUps({
  calls,
  today,
}: {
  /** Every call, unfiltered — see the note in the footer. */
  calls: CallRecord[];
  today: string;
}) {
  const result = followUps(calls, today);
  const shown = result.items.slice(0, SHOWN);
  const rest = result.items.slice(SHOWN);
  const restWorth = rest.reduce((sum, i) => sum + i.worth, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <div className="mb-1 flex items-center gap-2">
        <PhoneForwarded className="h-3.5 w-3.5 text-gold-500" strokeWidth={1.5} />
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          Follow-ups owed
        </h3>
      </div>

      {result.items.length === 0 ? (
        <p className="mt-3 text-[13px] text-zinc-400">
          No calls are sitting on a follow-up. Every prospect who was going to be
          spoken to again has already been marked something else.
        </p>
      ) : (
        <>
          <p className="mb-5 max-w-[75ch] text-[12px] leading-relaxed text-zinc-600">
            <span className="font-medium text-zinc-400">
              {result.items.length} calls
            </span>{" "}
            ended on &quot;speak again&quot; and have not been marked anything
            since, with{" "}
            <span className="font-medium text-gold-300">
              {formatReporting(result.worth)}
            </span>{" "}
            discussed across them. An outcome is written when the call ends and
            never rewritten, so nothing here ages out on its own — these are the
            calls to make.
          </p>

          <div className="space-y-1">
            {shown.map(({ call, age, worth }) => (
              <a
                key={call.id}
                href={call.notion_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5 transition-colors hover:border-white/[0.12] hover:bg-white/[0.03]"
              >
                <span
                  className={`w-[72px] shrink-0 font-mono text-[12px] tabular-nums ${
                    age >= FOLLOW_UP_COLD_DAYS
                      ? "text-red-400"
                      : age >= FOLLOW_UP_STALE_DAYS
                      ? "text-amber-400"
                      : "text-zinc-400"
                  }`}
                >
                  {age}d ago
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">
                  {call.name || "Unknown"}
                </span>
                <span className="w-[110px] shrink-0 truncate text-[12px] text-zinc-500">
                  {call.closer ?? "—"}
                </span>
                <span className="w-[80px] shrink-0 text-right font-mono text-[12px] tabular-nums text-gold-400/80">
                  {worth > 0 ? formatMoney(call.price_discussed, call.currency) : "—"}
                </span>
                <ExternalLink className="h-3 w-3 shrink-0 text-zinc-700" />
              </a>
            ))}
          </div>

          {/* Never a silent cut. A worklist that quietly stops at fifteen reads
              as a worklist of fifteen. */}
          {rest.length > 0 && (
            <p className="mt-2 text-[11px] text-zinc-500">
              {rest.length} more, worth {formatReporting(restWorth)}, all newer
              than these — open the tracker to work the rest.
            </p>
          )}

          <p className="mt-3 max-w-[75ch] text-[11px] leading-relaxed text-zinc-600">
            {result.cold > 0 && (
              <>
                <span className="text-zinc-500">
                  {result.cold} of these are over {FOLLOW_UP_COLD_DAYS} days old
                </span>{" "}
                and are realistically gone — worth one message rather than a
                place in the pipeline.{" "}
              </>
            )}
            This list ignores the date range at the top of the page on purpose: a
            follow-up owed since July is exactly the one a thirty-day view would
            hide. Money shown is what was discussed on the call, not money in.
          </p>
        </>
      )}
    </motion.div>
  );
}
