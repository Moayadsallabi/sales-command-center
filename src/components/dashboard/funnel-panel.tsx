"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import {
  LinkedBooking,
  funnelStats,
  sourceStats,
  closerDisagreements,
  LATE_CANCEL_HOURS,
} from "@/lib/bookings";
import { CalendarX2, Contact, Link2Off } from "lucide-react";

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
  pending,
  total,
}: {
  bookings: LinkedBooking[];
  calls: CallRecord[];
  windowStart: string | null;
  /** Bookings still being read from Calendly. */
  pending: number;
  /** Sales bookings in the window, read or not. */
  total: number;
}) {
  // A funnel built on part of the calendar is not a rough funnel, it is a
  // wrong one — every rate on it would move as the rest arrived. So nothing is
  // shown until the read finishes, which the page's own refresh will pick up.
  if (pending > 0) {
    const read = Math.max(total - pending, 0);
    return (
      <Shell windowStart={windowStart}>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
          <p className="text-[13px] text-zinc-300">
            Reading your calendar — {read.toLocaleString()} of{" "}
            {total.toLocaleString()} bookings so far.
          </p>
          <p className="mt-1.5 max-w-[75ch] text-[11px] leading-relaxed text-zinc-600">
            Each booking is a separate request to Calendly, and Calendly caps how
            many it will answer a minute, so the first read after a restart takes
            a couple of minutes. The page refreshes itself every sixty seconds
            and the funnel appears when the set is complete. Until then the show
            rate above counts recordings, as it did before Calendly was
            connected — a rate off half the bookings would be worse than the old
            one, not better.
          </p>
        </div>
      </Shell>
    );
  }

  const stats = funnelStats(bookings, calls);
  const sources = sourceStats(bookings);
  const disagreements = closerDisagreements(bookings, calls);

  const tagged = sources.filter((s) => s.source !== "Untagged");

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

        {/* Three numbers, each of which names something someone can go and
            fix. There was a show rate here; it is gone because it could not be
            stated — with most of the calendar producing no recording either
            way, the honest answer was a range forty points wide, and the width
            of that range is just the first tile below said as a percentage. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            label="Never accounted for"
            value={String(stats.unrecorded)}
            sub={
              stats.unrecorded === 0
                ? "every booking produced a recording or a cancellation"
                : `bookings that were due and produced neither a recording nor a cancellation`
            }
            accent
          />
          <Stat
            label="Cancelled by your own side"
            value={String(stats.canceledByHost)}
            sub={
              stats.canceled === 0
                ? "nothing cancelled in this window"
                : `of ${stats.canceled} cancellations — the prospect made ${stats.canceledByInvitee}`
            }
          />
          <Stat
            label="Late cancellations"
            value={String(stats.lateCancels)}
            sub={
              stats.canceled === 0
                ? "nothing cancelled in this window"
                : `of ${stats.canceled} cancelled, inside the last ${LATE_CANCEL_HOURS}h`
            }
          />
        </div>

        <p className="max-w-[75ch] text-[12px] leading-relaxed text-zinc-400">
          {stats.showRate == null ? (
            <>Nothing in this window has been accounted for yet.</>
          ) : (
            <>
              {stats.booked} calls were booked and {stats.kept} produced a
              recording. {stats.canceled} were cancelled
              {stats.medianCancelNotice != null && (
                <> on {formatNotice(stats.medianCancelNotice)} of notice</>
              )}
              , and {stats.noShow} nobody turned up to.{" "}
              {stats.canceledByHost > stats.canceledByInvitee && (
                <span className="text-zinc-300">
                  Cancelling your own booked calls is the largest single thing
                  happening on this calendar, and it is not the prospects doing
                  it.{" "}
                </span>
              )}
              {stats.canceledAfterStart > 0 && (
                <>
                  {stats.canceledAfterStart} were cancelled after the call was
                  already due to start, which is usually a no-show being cleared
                  off the calendar afterwards.{" "}
                </>
              )}
              {stats.unrecorded > 0 && (
                <span className="text-zinc-300">
                  Until the {stats.unrecorded} unaccounted-for bookings get
                  recorded, no rate on this page can be trusted to within forty
                  points.
                </span>
              )}
            </>
          )}
        </p>

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
            {stats.matchedByName + stats.matchedByFirstNameOnly > 0 && (
              <Note icon={<Contact className="h-3 w-3" />}>
                {stats.matchedByName + stats.matchedByFirstNameOnly} of these were
                tied to a call by name and date rather than by email, because those
                calls carry no email —{" "}
                <span className="text-zinc-400">
                  {stats.matchedByName} on a full name
                </span>
                {stats.matchedByFirstNameOnly > 0 && (
                  <>
                    ,{" "}
                    <span className="text-zinc-400">
                      {stats.matchedByFirstNameOnly} on a first name alone
                    </span>
                  </>
                )}
                . Each had to be the only candidate on the day, on both sides. The
                first-name ties are the weakest thing on this page: right far more
                often than not, but an inference. Putting the prospect&apos;s email
                on the call record replaces all of it with a certainty.
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
