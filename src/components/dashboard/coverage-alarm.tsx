"use client";

import { CallRecord } from "@/lib/types";
import {
  recordingWeeks,
  silentClosers,
  SILENCE_DAYS,
} from "@/lib/follow-ups";
import { AlertTriangle, Activity } from "lucide-react";
import { Panel, PanelHeader } from "./panel";

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
 * WHERE IT LIVES: the data-health band at the BOTTOM of the page, after the
 * call table (Moayad, 2026-08-18). It opened the page for a while, which put a
 * caveat in front of the result it qualifies and made every visit lead with a
 * problem. This panel does not describe the business; it describes how much of
 * the business the page can see, which is what a reader goes looking for when a
 * number surprises them.
 *
 * If a stoppage ever goes unnoticed again, the fix is a one-line strip in the
 * page header while this panel is alarming — the slim treatment the FX-rate
 * notice already uses — pointing down at it. Not moving the panel back to the
 * top, which is the arrangement that was rejected.
 *
 * It reads the whole tracker, never the filtered window: the point is to
 * compare recent weeks against normal ones, and a seven-day view has no normal
 * to compare against.
 */
export function CoverageAlarm({
  calls,
  today,
  booked = null,
  order = 0,
}: {
  /** Every call, unfiltered. */
  calls: CallRecord[];
  today: string;
  /** Bookings in the visible window, when Calendly is connected. */
  booked?: number | null;
  order?: number;
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
    <Panel order={order} tone={alarming ? "alert" : "default"}>
      <PanelHeader
        icon={alarming ? AlertTriangle : Activity}
        title="Is the tracker still being fed"
        subtitle="Six weeks of recordings, and any closer who has gone quiet."
        info={
          <>
            <p>
              A call that never reaches the tracker is missing from every figure
              on this page — close rate, cash, the scorecards — and nothing
              about the page looks wrong when it happens. A close rate does not
              wobble when a closer stops delivering recordings; it stays
              perfectly plausible and describes a fraction of the business.
            </p>
            <p>
              That failure has already happened here once and took five weeks to
              notice, which is why it has a panel rather than a footnote.
            </p>
            <p>
              This reads the whole tracker and ignores the date range at the top
              of the page: the point is to compare recent weeks against normal
              ones, and a seven-day window has no normal to compare against. The
              current week is never the evidence a warning rests on, because it
              is part-run by definition and would fire every Monday.
            </p>
            <p>A closer counts as quiet after {SILENCE_DAYS} days.</p>
          </>
        }
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:gap-8">
        {/* Six weeks of recordings, empty weeks included. A gap week left out
            would turn a stoppage into a shorter chart. */}
        <div className="shrink-0">
          <div className="flex h-16 items-end gap-1.5">
            {/* GREY BARS, ONE GOLD. Every past week was drawn in gold at half
                opacity, which over this page's background lands as mustard —
                six bars of it, and the one bar the panel's own logic cares
                about looked exactly like the other five. The last FULL week is
                the week every warning here rests on, so it is the one that
                carries the colour: gold normally, amber when it has collapsed.
                The current week stays the palest, because it is part-run by
                definition and is never the evidence. */}
            {weeks.map((w, i) => {
              const current = i === weeks.length - 1;
              const lastFull = i === weeks.length - 2;
              return (
                <div key={w.week} className="flex w-9 flex-col items-center gap-1">
                  <span className="font-mono text-[11px] tabular-nums text-zinc-300">
                    {w.calls}
                  </span>
                  <div
                    className={`w-full rounded-sm ${
                      current
                        ? "bg-white/[0.10]"
                        : lastFull && collapsed
                        ? "bg-amber-500/80"
                        : lastFull
                        ? "bg-gold-500"
                        : "bg-white/[0.18]"
                    }`}
                    style={{ height: `${Math.max((w.calls / peak) * 40, 2)}px` }}
                    title={`${w.calls} recorded in the week of ${w.week}${
                      current
                        ? " — this week, still running"
                        : lastFull
                        ? " — the last full week, which is what any warning here is measured on"
                        : ""
                    }`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-zinc-400">
            <span>6 weeks ago</span>
            <span>this week</span>
          </div>
          {/* One gold bar among five grey ones needs saying, or it reads as
              decoration. Named here rather than left in a tooltip, because the
              whole panel rests on that week. */}
          <p className="mt-1 text-[11px] text-zinc-400">
            <span className={collapsed ? "text-amber-400" : "text-gold-400"}>
              ▪
            </span>{" "}
            last full week — what the reading below is measured on
          </p>
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

          {/* The long version of this moved into the panel's info popover.
              What stays on screen is the one fact that changes with the date
              range and therefore cannot be written once and forgotten. */}
          {booked != null && booked > 0 && (
            <p className="max-w-[80ch] text-[11px] leading-relaxed text-zinc-400">
              Calendly has {booked} bookings in the window currently shown, so
              that is the ceiling the recordings are being measured against.
            </p>
          )}
        </div>
      </div>
    </Panel>
  );
}
