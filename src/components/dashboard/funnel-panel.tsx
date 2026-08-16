"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import {
  LinkedBooking,
  funnelStats,
  leadTimeBuckets,
  sourceStats,
  closerDisagreements,
  LATE_CANCEL_HOURS,
  MIN_PER_LEAD_BUCKET,
} from "@/lib/bookings";
import { CalendarX2, Link2Off } from "lucide-react";

/**
 * What was booked, against what was recorded.
 *
 * Every other panel starts from a recording, which means it can only describe
 * calls that happened. This one starts from the calendar, so it can describe
 * the ones that did not: the cancellations, the people who never turned up,
 * and the bookings nobody recorded either way.
 */
export function FunnelPanel({
  bookings,
  calls,
  windowStart,
}: {
  bookings: LinkedBooking[];
  calls: CallRecord[];
  windowStart: string | null;
}) {
  const stats = funnelStats(bookings, calls);
  const buckets = leadTimeBuckets(bookings);
  const sources = sourceStats(bookings);
  const disagreements = closerDisagreements(bookings, calls);

  const tagged = sources.filter((s) => s.source !== "Untagged");
  const readyBuckets = buckets.filter((b) => b.ready);
  const spread =
    readyBuckets.length >= 2
      ? Math.max(...readyBuckets.map((b) => b.showRate)) -
        Math.min(...readyBuckets.map((b) => b.showRate))
      : null;

  if (stats.booked === 0 && stats.upcoming === 0) {
    return (
      <Shell windowStart={windowStart}>
        <p className="text-[13px] text-zinc-400">
          No bookings in this window. Either nothing was booked, or the calls
          that were booked sit on a Calendly event type this dashboard is not
          counting — check <code className="text-zinc-300">CALENDLY_EVENT_TYPES</code>.
        </p>
      </Shell>
    );
  }

  return (
    <Shell windowStart={windowStart}>
      <div className="space-y-5">
        {/* The four states every past booking ends in, as one bar. */}
        <div>
          <Bar stats={stats} />
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
            <Key tone="bg-gold-500/70" label="Held" value={stats.kept} />
            <Key tone="bg-zinc-600/70" label="No-show" value={stats.noShow} />
            <Key tone="bg-indigo-500/50" label="Cancelled" value={stats.canceled} />
            {stats.unrecorded > 0 && (
              <Key
                tone="bg-white/[0.06]"
                label="Not recorded"
                value={stats.unrecorded}
              />
            )}
            {stats.upcoming > 0 && (
              <span className="ml-auto text-zinc-600">
                {stats.upcoming} still to come — not counted above
              </span>
            )}
          </div>
        </div>

        {/* Show rate, honestly bounded. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="Show rate"
            value={stats.showRate == null ? "—" : `${Math.round(stats.showRate)}%`}
            sub={
              stats.unrecorded > 0 && stats.showRateRange
                ? `${Math.round(stats.showRateRange.low)}–${Math.round(
                    stats.showRateRange.high
                  )}% once the unrecorded are counted`
                : `${stats.kept} of ${stats.kept + stats.noShow} that were due`
            }
            accent
          />
          <Stat
            label="Booked that held"
            value={stats.heldRate == null ? "—" : `${Math.round(stats.heldRate)}%`}
            sub={`${stats.kept} calls out of ${stats.booked} bookings made`}
          />
          <Stat
            label="Late cancellations"
            value={String(stats.lateCancels)}
            sub={
              stats.canceled === 0
                ? "nothing cancelled in this window"
                : `of ${stats.canceled} cancelled, inside ${LATE_CANCEL_HOURS}h`
            }
          />
        </div>

        <p className="max-w-[75ch] text-[12px] leading-relaxed text-zinc-400">
          {stats.showRate == null ? (
            <>Nothing in this window has been accounted for yet.</>
          ) : (
            <>
              Of the {stats.booked} calls booked, {stats.kept} happened,{" "}
              {stats.noShow} nobody turned up to and {stats.canceled} were called
              off beforehand.{" "}
              {stats.canceled > 0 && stats.medianCancelNotice != null && (
                <>
                  The typical cancellation gave{" "}
                  <span className="font-medium text-zinc-200">
                    {formatNotice(stats.medianCancelNotice)}
                  </span>{" "}
                  of notice, and{" "}
                  {stats.canceledByInvitee === stats.canceled
                    ? "every one came from the prospect"
                    : `${stats.canceledByInvitee} of them came from the prospect`}
                  .{" "}
                </>
              )}
              {stats.unrecorded > 0 && (
                <>
                  <span className="text-zinc-300">
                    {stats.unrecorded} bookings were due and produced neither a
                    recording nor a cancellation
                  </span>
                  , so nobody can say from here whether those people turned up.
                  That is the number to shrink: it is the width of the range
                  above.
                </>
              )}
            </>
          )}
        </p>

        {/* Lead time — the one lever this panel exposes that coaching cannot reach. */}
        <div>
          <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
            Show rate by how far ahead it was booked
          </h4>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {buckets.map((bucket) => (
              <div
                key={bucket.label}
                className="rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2.5"
              >
                <div className="text-[11px] text-zinc-500">{bucket.label}</div>
                <div
                  className={`mt-0.5 font-mono text-[15px] tabular-nums ${
                    bucket.ready ? "text-zinc-200" : "text-zinc-600"
                  }`}
                >
                  {bucket.accounted === 0 ? "—" : `${Math.round(bucket.showRate)}%`}
                </div>
                <div className="text-[10px] text-zinc-600">
                  {bucket.accounted === 0
                    ? "no bookings"
                    : bucket.ready
                    ? `${bucket.kept} of ${bucket.accounted}`
                    : `${bucket.accounted} booking${
                        bucket.accounted === 1 ? "" : "s"
                      } — too few to read`}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 max-w-[75ch] text-[12px] leading-relaxed text-zinc-500">
            {spread != null && spread >= 15 ? (
              <>
                There is a{" "}
                <span className="font-medium text-gold-300">
                  {Math.round(spread)}-point
                </span>{" "}
                spread between these buckets. When the gap sits this wide, the
                fix is in booking and confirmation — reminders, shorter lead
                times, a confirmation step — not in how the calls are run.
              </>
            ) : (
              <>
                Buckets under {MIN_PER_LEAD_BUCKET} bookings are greyed out
                rather than shown as a rate, because at that size one person
                turning up moves the number by twenty points.
              </>
            )}
          </p>
        </div>

        {/* Where the bookings came from, from the link rather than the call. */}
        {tagged.length > 0 && (
          <div>
            <h4 className="mb-2 text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Booked and showed, by booking link
            </h4>
            <div className="space-y-1">
              {sources.slice(0, 6).map((source) => (
                <div
                  key={source.source}
                  className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3 py-2"
                >
                  <span
                    className={`w-[120px] shrink-0 truncate text-[12px] ${
                      source.source === "Untagged" ? "text-zinc-600" : "text-zinc-300"
                    }`}
                  >
                    {source.source}
                  </span>
                  <span className="flex-1 text-[11px] text-zinc-600">
                    {source.booked} booked
                    {source.noShow > 0 && ` · ${source.noShow} no-show`}
                  </span>
                  <span className="w-11 shrink-0 text-right font-mono text-[12px] tabular-nums text-zinc-400">
                    {source.showRate == null ? "—" : `${Math.round(source.showRate)}%`}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 max-w-[75ch] text-[12px] leading-relaxed text-zinc-500">
              This is the utm tag on the link they booked through, recorded
              before anyone spoke. The source on the call table is the scorer&apos;s
              reading of what the prospect said afterwards, and only exists for
              calls that happened — no-shows have a source here and nowhere else.
            </p>
          </div>
        )}

        {/* Data-health notes, stated rather than folded into the numbers. */}
        {(stats.callsWithoutBooking > 0 || disagreements.length > 0) && (
          <div className="space-y-1.5 border-t border-white/[0.05] pt-3">
            {stats.callsWithoutBooking > 0 && (
              <Note icon={<Link2Off className="h-3 w-3" />}>
                {stats.callsWithoutBooking} recorded{" "}
                {stats.callsWithoutBooking === 1 ? "call has" : "calls have"} no
                booking behind{" "}
                {stats.callsWithoutBooking === 1 ? "it" : "them"} — booked
                outside Calendly, booked on an event type this dashboard is not
                counting, or missing the prospect email the two are matched on.
                Those calls count everywhere else on this page, but not in the
                rates above.
              </Note>
            )}
            {disagreements.length > 0 && (
              <Note icon={<CalendarX2 className="h-3 w-3" />}>
                On {disagreements.length}{" "}
                {disagreements.length === 1 ? "call" : "calls"}, Calendly
                assigned one person and the recording credited another
                {disagreements.length <= 3 &&
                  ` (${disagreements
                    .map((d) => `${d.assigned} → ${d.credited}`)
                    .join(", ")})`}
                . Credit follows whoever spoke most, so a manager sitting in can
                take it.
              </Note>
            )}
          </div>
        )}
      </div>
    </Shell>
  );
}

/* ---------------------------------------------------------------- pieces */

function Shell({
  windowStart,
  children,
}: {
  windowStart: string | null;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.35, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <div className="mb-1 flex items-center gap-2">
        <CalendarX2 className="h-3.5 w-3.5 text-gold-500" strokeWidth={1.5} />
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          Booked versus recorded
        </h3>
      </div>
      <p className="mb-5 max-w-[75ch] text-[12px] leading-relaxed text-zinc-600">
        Everything else on this page starts from a recording, so it can only
        count calls that happened. This starts from Calendly, which knows about
        the ones that did not.
        {windowStart && (
          <>
            {" "}
            Bookings are read back to {windowStart.slice(0, 10)} — a longer date
            range above will show calls from before that with no bookings behind
            them.
          </>
        )}
      </p>
      {children}
    </motion.div>
  );
}

function Bar({ stats }: { stats: ReturnType<typeof funnelStats> }) {
  const total = Math.max(stats.booked, 1);
  const segments = [
    { key: "kept", value: stats.kept, className: "bg-gold-500/70" },
    { key: "noShow", value: stats.noShow, className: "bg-zinc-600/70" },
    { key: "canceled", value: stats.canceled, className: "bg-indigo-500/50" },
    { key: "unrecorded", value: stats.unrecorded, className: "bg-white/[0.06]" },
  ].filter((s) => s.value > 0);

  return (
    <div className="flex h-7 gap-0.5 overflow-hidden rounded">
      {segments.map((segment) => (
        <div
          key={segment.key}
          className={`flex items-center justify-center ${segment.className}`}
          style={{ width: `${(segment.value / total) * 100}%` }}
          title={`${segment.value} of ${stats.booked} bookings`}
        >
          {segment.value / total > 0.06 && (
            <span className="font-mono text-[11px] tabular-nums text-white/70">
              {segment.value}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function Key({ tone, label, value }: { tone: string; label: string; value: number }) {
  return (
    <span className="flex items-center gap-1.5 text-zinc-500">
      <span className={`h-2 w-2 rounded-sm ${tone}`} />
      {label} <span className="tabular-nums text-zinc-400">{value}</span>
    </span>
  );
}

function Stat({
  label,
  value,
  sub,
  accent = false,
}: {
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-600">
        {label}
      </div>
      <div
        className={`mt-1 font-mono text-[22px] tabular-nums ${
          accent ? "text-gold-400" : "text-zinc-200"
        }`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11px] leading-snug text-zinc-600">{sub}</div>
    </div>
  );
}

function Note({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2 text-[11px] leading-relaxed text-zinc-500">
      <span className="mt-0.5 shrink-0 text-zinc-600">{icon}</span>
      <span className="max-w-[75ch]">{children}</span>
    </div>
  );
}

/** "18 hours" / "3 days", whichever reads as the human amount. */
function formatNotice(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${Math.round(hours)} hours`;
  return `${Math.round(hours / 24)} days`;
}
