"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import { followUps, FOLLOW_UP_COLD_DAYS, FOLLOW_UP_STALE_DAYS } from "@/lib/follow-ups";
import { formatMoney, formatReporting } from "@/lib/money";
import { PhoneForwarded, ExternalLink } from "lucide-react";

/** How many rows before the list stops being a list and becomes a wall. */
const SHOWN = 15;

/** "August" from a YYYY-MM-DD. Parsed as UTC so it cannot slip a month. */
function monthName(today: string): string {
  return new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
}

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
          Follow-ups owed — {monthName(today)}
        </h3>
      </div>

      {result.items.length === 0 ? (
        <p className="mt-3 max-w-[75ch] text-[13px] leading-relaxed text-zinc-400">
          Nothing owed from {monthName(today)}&apos;s calls.
          {result.lapsed > 0 && (
            <>
              {" "}
              <span className="text-zinc-500">
                {result.lapsed} {result.lapsed === 1 ? "is" : "are"} still open
                from last month
              </span>
              , worth {formatReporting(result.lapsedWorth)}. Those do not carry
              over — the list starts clean each month.
            </>
          )}
        </p>
      ) : (
        <>
          <p className="mb-5 max-w-[75ch] text-[12px] leading-relaxed text-zinc-600">
            <span className="font-medium text-zinc-400">
              {result.items.length} calls
            </span>{" "}
            from {monthName(today)} ended on &quot;speak again&quot; and have
            not been marked anything since, with{" "}
            <span className="font-medium text-gold-300">
              {formatReporting(result.worth)}
            </span>{" "}
            quoted across them.{" "}
            {result.cold > 0 && (
              <>
                <span className="font-medium text-zinc-400">
                  {result.cold} have been waiting over a fortnight.
                </span>{" "}
              </>
            )}
            These are this month&apos;s calls to make.
          </p>

          {/* Named columns. The right-hand figure was reading as revenue when
              it is a quote — the price talked about on a call that did not
              close. Nothing here is money in. */}
          <div className="flex items-center gap-3 px-3.5 pb-1.5 text-[10px] uppercase tracking-[0.1em] text-zinc-600">
            <span className="w-[72px] shrink-0">Waiting</span>
            <span className="min-w-0 flex-1">Prospect</span>
            <span className="w-[110px] shrink-0">Closer</span>
            <span className="w-[90px] shrink-0 text-right">Price quoted</span>
            <span className="w-3 shrink-0" />
          </div>

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
                <span className="w-[90px] shrink-0 text-right font-mono text-[12px] tabular-nums text-zinc-400">
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
            <span className="text-zinc-500">
              This is {monthName(today)}&apos;s list, and it does not carry into
              next month
            </span>
            . A prospect also leaves it the moment a later call with them reaches
            the tracker, because nothing ever edits the original row — the
            follow-up arrives as its own recording a few days later.
            {result.spokenAgain > 0 && (
              <>
                {" "}
                {result.spokenAgain}{" "}
                {result.spokenAgain === 1 ? "prospect has" : "prospects have"}{" "}
                dropped off that way. A follow-up that happens without being
                recorded cannot be told apart from one that never happened, so it
                stays until the month turns over.
              </>
            )}
            {result.lapsed > 0 && (
              <>
                {" "}
                <span className="text-zinc-500">
                  {result.lapsed} older {result.lapsed === 1 ? "one is" : "ones are"}{" "}
                  not shown
                </span>{" "}
                — {formatReporting(result.lapsedWorth)} quoted, still open on the
                tracker, but last month&apos;s list rather than this one.
              </>
            )}{" "}
            The date range at the top of the page does not apply here.
          </p>
        </>
      )}
    </motion.div>
  );
}
