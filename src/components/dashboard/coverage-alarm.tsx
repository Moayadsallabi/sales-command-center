"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import {
  recordingWeeks,
  silentClosers,
  SILENCE_DAYS,
} from "@/lib/follow-ups";
import { AlertTriangle, Activity } from "lucide-react";

/**
 * Whether the tracker is still being fed.
 *
 * Every figure below this on the page is computed from recordings, so every
 * one of them is wrong in exact proportion to the recordings that never
 * arrived — and a missing call is invisible by definition. A close rate does
 * not wobble when a closer stops delivering; it stays perfectly plausible and
 * describes a fraction of the business.
 *
 * That failure has already happened here once and took five weeks to notice,
 * so it gets its own panel rather than the footnote it used to be.
 *
 * It sits directly BELOW the KPI cards, not above them (moved 2026-08-18). It
 * opened the page for a while, which put a caveat in front of the result it
 * qualifies and made every visit lead with a problem. Beneath the numbers it
 * still cannot be missed and it finally reads in the right order: here is the
 * close rate, and here is how much of the business it actually covers.
 *
 * It reads the whole tracker, never the filtered window: the point is to
 * compare recent weeks against normal ones, and a seven-day view has no normal
 * to compare against.
 */
export function CoverageAlarm({
  calls,
  today,
  booked = null,
}: {
  /** Every call, unfiltered. */
  calls: CallRecord[];
  today: string;
  /** Bookings in the visible window, when Calendly is connected. */
  booked?: number | null;
}) {
  const weeks = recordingWeeks(calls, today, 6);
  const silent = silentClosers(calls, today);

  // The current week is part-run by definition, so it is never the evidence a
  // warning rests on — it would fire every Monday morning.
  const past = weeks.slice(0, -1);
  const latest = past[past.length - 1];
  const earlier = past.slice(0, -1);
  const typical =
    earlier.length > 0
      ? earlier.reduce((sum, w) => sum + w.calls, 0) / earlier.length
      : 0;
  // Half the usual volume, on a base big enough for half to mean something.
  const collapsed = typical >= 4 && latest != null && latest.calls < typical / 2;

  const peak = Math.max(...weeks.map((w) => w.calls), 1);
  const alarming = collapsed || silent.length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`rounded-xl border p-5 ${
        alarming
          ? "border-amber-500/25 bg-amber-500/[0.04]"
          : "border-white/[0.06] glass-card"
      }`}
    >
      <div className="mb-4 flex items-center gap-2">
        {alarming ? (
          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" strokeWidth={1.5} />
        ) : (
          <Activity className="h-3.5 w-3.5 text-gold-500" strokeWidth={1.5} />
        )}
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          Is the tracker still being fed
        </h3>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
        {/* Six weeks of recordings, empty weeks included. A gap week left out
            would turn a stoppage into a shorter chart. */}
        <div className="shrink-0">
          <div className="flex h-16 items-end gap-1.5">
            {weeks.map((w, i) => {
              const current = i === weeks.length - 1;
              return (
                <div key={w.week} className="flex w-9 flex-col items-center gap-1">
                  <span className="font-mono text-[10px] tabular-nums text-zinc-500">
                    {w.calls}
                  </span>
                  <div
                    className={`w-full rounded-sm ${
                      current
                        ? "bg-white/[0.10]"
                        : collapsed && i === weeks.length - 2
                        ? "bg-amber-500/60"
                        : "bg-gold-500/50"
                    }`}
                    style={{ height: `${Math.max((w.calls / peak) * 40, 2)}px` }}
                    title={`${w.calls} recorded in the week of ${w.week}`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[10px] text-zinc-600">
            <span>6 weeks ago</span>
            <span>this week</span>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          {collapsed && latest && (
            <p className="text-[13px] leading-relaxed text-amber-300">
              Last full week produced{" "}
              <span className="font-medium">
                {latest.calls} {latest.calls === 1 ? "recording" : "recordings"}
              </span>{" "}
              against a recent average of {Math.round(typical)}. Either far fewer
              calls happened, or they happened and were not recorded — and only
              one of those is a sales problem.
            </p>
          )}

          {silent.map((c) => (
            <p key={c.closer} className="text-[13px] leading-relaxed text-amber-300">
              <span className="font-medium">{c.closer}</span> has recorded nothing
              for <span className="font-medium">{c.days} days</span> — last call{" "}
              {c.lastCall}, {c.calls} in total. Either they have stopped taking
              calls, or their recordings have stopped arriving. Nothing on this
              page can tell those apart, so it is worth a message.
            </p>
          ))}

          {!alarming && (
            <p className="text-[13px] text-zinc-400">
              Recordings are arriving at a steady rate and every closer who was
              recording still is.
            </p>
          )}

          <p className="max-w-[75ch] text-[11px] leading-relaxed text-zinc-600">
            A call that never reaches the tracker is missing from every figure on
            this page — close rate, cash, the scorecards — and nothing about the
            page looks wrong when it happens.{" "}
            {booked != null && booked > 0 && (
              <>
                Calendly has {booked} bookings in the window currently shown, so
                that is the ceiling the recordings are being measured against.{" "}
              </>
            )}
            A closer counts as quiet after {SILENCE_DAYS} days.
          </p>
        </div>
      </div>
    </motion.div>
  );
}
