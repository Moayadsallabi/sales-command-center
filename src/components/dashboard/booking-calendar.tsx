"use client";

/**
 * THE CALENDAR: EVERY BOOKING ON THE BOOK, HELD OR NOT.
 *
 * The rest of this page counts bookings. This one shows them — where they sit
 * in a week, which days are empty, whether the cancellations cluster on a
 * Monday, and what is still ahead. None of that is available from a funnel,
 * and a shape is the one thing a row of tiles cannot draw.
 *
 * ---------------------------------------------------------------------------
 * THREE THINGS IT REFUSES TO DO
 *
 * 1. IT NEVER CALLS AN UNMATCHED BOOKING A NO-SHOW. A booking with no
 *    recording behind it is drawn as "Not recorded", because it is either
 *    somebody who did not turn up or a call nobody hit record on, and those
 *    want opposite fixes. Only Calendly's own mark, or a call logged as one,
 *    gets the no-show colour. Same rule as lib/bookings.ts, same reason.
 *
 * 2. IT NEVER DRAWS AN UNREAD MONTH AS AN EMPTY ONE. Calendly is read over a
 *    window; step back beyond it and the grid says the calendar was never
 *    asked about those weeks, rather than showing a month of blank cells that
 *    reads as a quiet quarter.
 *
 * 3. IT DOES NOT FOLLOW THE DATE BUTTONS, AND SAYS SO ON THE PANEL. Every
 *    other panel narrows to the period at the top of the page. A calendar
 *    whose month jumped whenever the range changed would be unusable — you
 *    move around a calendar by the month, which is what the arrows are for.
 *    An exemption from the filter that is not written on the screen reads as a
 *    broken filter, so it is written on the screen.
 *
 * The closer filter DOES apply, because that is a filter on whose calendar
 * this is rather than on which window, and a leaderboard click that narrowed
 * every panel but this one would be the same fault in the other direction.
 */

import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from "lucide-react";
import { BookingState, LinkedBooking } from "@/lib/bookings";
import { CallRecord } from "@/lib/types";
import {
  CALENDAR_STATES,
  CalendarEntry,
  MonthKey,
  groupByDay,
  monthCoverage,
  monthGrid,
  monthName,
  monthOf,
  shiftMonth,
  stateCounts,
  usableZone,
  zoneLabel,
} from "@/lib/calendar";
import { Panel, PanelHeader } from "./panel";
import { cn } from "@/lib/utils";

/**
 * THE FIVE TREATMENTS, and why each colour is the one it is.
 *
 * Gold is the brand and carries no verdict, so it marks the two states that
 * are simply the calendar working: a call that happened, and one that is
 * coming. Amber is this page's colour for "we cannot see this" — it is what
 * the data-health band is drawn in — so it marks the bookings whose fate is
 * genuinely unknown. Red is a verdict and is spent on the one state that has
 * earned one. A cancellation is not a failure, it is an absence, so it is
 * drawn as an absence: no fill, struck through, out of the way.
 *
 * The semantic pair is written as `var(--color-negative)` rather than a
 * Tailwind shade because that is how the rest of this page reaches it — see
 * delta.tsx — and a shade that does not exist emits nothing at all.
 */
const CHIP: Record<BookingState, string> = {
  kept: "border-l-gold-500 bg-white/[0.05] text-zinc-200",
  upcoming: "border-l-gold-400 bg-gold-500/[0.10] text-gold-200",
  unrecorded: "border-l-amber-400/70 bg-amber-500/[0.07] text-amber-200",
  no_show:
    "border-l-[var(--color-negative)] bg-[var(--color-negative-dim)] text-[var(--color-negative)]",
  canceled: "border-l-white/15 text-zinc-500 line-through decoration-zinc-600",
};

/** The same five as a solid swatch, for the legend and the count strip. */
const SWATCH: Record<BookingState, string> = {
  kept: "bg-gold-500",
  upcoming: "bg-gold-400/50",
  unrecorded: "bg-amber-400/70",
  no_show: "bg-[var(--color-negative)]",
  canceled: "bg-white/20",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Chips drawn in a cell before the rest collapse behind a "+n more". */
const CHIPS_PER_CELL = 3;

export function BookingCalendar({
  order = 0,
  bookings,
  calls,
  today,
  timezone,
  windowStart,
  reading,
  pending,
  closer,
  onSelectCall,
}: {
  order?: number;
  /** Every booking read, already narrowed to the selected closer if there is one. */
  bookings: LinkedBooking[];
  /** Used to open a held call's scorecard from its chip. */
  calls: CallRecord[];
  /** Today as `YYYY-MM-DD`, resolved on the server so both renders agree. */
  today: string;
  /** The Calendly account's zone. Null falls back to UTC, labelled UTC. */
  timezone: string | null;
  /** Earliest instant the Calendly read covers. Before it, nothing was asked. */
  windowStart: string | null;
  /** The calendar has never been read at all this process. */
  reading: boolean;
  /** Bookings whose invitees are still being fetched. */
  pending: number;
  /** Set when the leaderboard has narrowed the page to one person. */
  closer: string | null;
  onSelectCall: (call: CallRecord) => void;
}) {
  const [month, setMonth] = useState<MonthKey>(() => monthOf(today));
  /** The one day expanded past `CHIPS_PER_CELL`. Only ever one at a time. */
  const [expanded, setExpanded] = useState<string | null>(null);

  const zone = usableZone(timezone);
  const grid = useMemo(() => monthGrid(month), [month]);
  const { days, dropped } = useMemo(
    () => groupByDay(bookings, zone),
    [bookings, zone]
  );

  // Same zone as the cells, so the day this names is one you can point at.
  const coverage = monthCoverage(month, windowStart, zone);
  const thisMonth = monthOf(today);

  /** The month's own bookings — the padding days either side are not counted. */
  const inMonth = useMemo(() => {
    const entries: CalendarEntry[] = [];
    for (const [day, list] of days) {
      if (day.slice(0, 7) === month) entries.push(...list);
    }
    return entries;
  }, [days, month]);

  const counts = useMemo(
    () => stateCounts(inMonth.map((e) => e.booking)),
    [inMonth]
  );

  const callById = useMemo(() => {
    const map = new Map<string, CallRecord>();
    for (const call of calls) map.set(call.id, call);
    return map;
  }, [calls]);

  const openCall = (booking: LinkedBooking) => {
    const call = booking.call_id ? callById.get(booking.call_id) : null;
    if (call) onSelectCall(call);
  };

  return (
    <Panel order={order}>
      <PanelHeader
        icon={CalendarDays}
        title="Calendar"
        subtitle={`Every booking on the Calendly calendar, held or not. Times in ${zoneLabel(
          zone
        )}.`}
        info={
          <div className="space-y-2.5">
            <p>
              One cell per day, one chip per booking, drawn from the same
              Calendly read the funnel above is counted from. It is here for the
              things a count cannot show: which days fill and which stay empty,
              whether cancellations land on the same weekday every week, and
              what is still on the book for the rest of the month.
            </p>
            <p>
              <strong className="text-zinc-200">
                The date buttons at the top of the page do not move this
                calendar.
              </strong>{" "}
              You move around a calendar by the month, so the arrows do that
              instead. The closer filter does apply — clicking a name on the
              leaderboard leaves that person&apos;s bookings only. The outcome
              and lead-source pills do not, because both describe a recording
              and most of what is drawn here never produced one.
            </p>
            <p>
              <strong className="text-zinc-200">
                A booking with no recording is not called a no-show.
              </strong>{" "}
              It is drawn as <em>Not recorded</em>, because it is either
              somebody who did not turn up or a call nobody hit record on, and
              those two want opposite fixes. Only Calendly&apos;s own no-show
              mark, or a call logged as one on the tracker, gets that colour.
            </p>
            <p>
              <strong className="text-zinc-200">Times are the account&apos;s.</strong>{" "}
              Calendly hands over every start time in UTC, and the rest of this
              page reads dates as UTC on purpose. A calendar cannot: a booking
              at 00:30 UTC is a call at half seven the previous evening for the
              team taking it, and drawing it as UTC puts it on the wrong day.
              So the grid uses the zone set on the Calendly account —{" "}
              {zoneLabel(zone)} — and nothing on this panel is used as a
              denominator anywhere else.
            </p>
            <p>
              Chips for calls that were held open that call&apos;s scorecard.
              The rest have nothing behind them to open.
            </p>
          </div>
        }
        right={
          <MonthStepper
            month={month}
            onChange={(next) => {
              setMonth(next);
              setExpanded(null);
            }}
            today={thisMonth}
          />
        }
      />

      {closer && (
        <p className="mb-3 t-body text-zinc-400">
          Showing{" "}
          <span className="text-zinc-200">{closer}</span>&apos;s bookings only.
          A booking belongs to the closer of the call it produced, and to its
          Calendly host when it produced none.
        </p>
      )}

      {reading && (
        <Notice tone="amber" icon>
          The calendar is being read from Calendly now. It is empty because
          nothing has arrived yet, not because nothing was booked. This page
          refreshes itself every minute.
        </Notice>
      )}

      {!reading && pending > 0 && (
        <Notice tone="amber" icon>
          {pending} booking{pending === 1 ? "" : "s"} on this calendar
          {pending === 1 ? " is" : " are"} still being read, so some days are
          incomplete. This page refreshes itself every minute.
        </Notice>
      )}

      {coverage.kind === "unread" && (
        <Notice tone="zinc">
          {monthName(month)} is before the calendar was read. Calendly is asked
          for a fixed window — nothing from this month was ever fetched, so an
          empty grid here means <em>not asked</em>, not <em>not booked</em>.
        </Notice>
      )}

      {coverage.kind === "partial" && (
        <Notice tone="zinc">
          The calendar was read from {longDate(coverage.from)} onwards. Days in{" "}
          {monthName(month)} before that were never fetched, and are drawn
          empty for that reason rather than because nothing was booked.
        </Notice>
      )}

      {dropped > 0 && (
        <Notice tone="amber" icon>
          {dropped} booking{dropped === 1 ? "" : "s"} had a start time this page
          could not read, and {dropped === 1 ? "is" : "are"} on no day below.
        </Notice>
      )}

      <Legend counts={counts} total={inMonth.length} month={month} />

      {/* ------------------------------------------------------- the grid */}
      {/* Below `sm` this is replaced by the agenda underneath: seven columns
          of chips in a phone's width is four characters a cell, and the page
          already scrolls sideways in two other places. */}
      <div className="mt-4 hidden sm:block">
        <div className="grid grid-cols-7 gap-px">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              className="pb-1.5 text-center t-label text-zinc-400"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-white/[0.06] bg-white/[0.06]">
          {grid.map((day) => (
            <DayCell
              key={day}
              day={day}
              month={month}
              today={today}
              entries={days.get(day) ?? []}
              expanded={expanded === day}
              onExpand={() => setExpanded(expanded === day ? null : day)}
              onOpen={openCall}
            />
          ))}
        </div>
      </div>

      {/* ------------------------------------------------------ the agenda */}
      <Agenda
        month={month}
        days={days}
        grid={grid}
        today={today}
        onOpen={openCall}
      />
    </Panel>
  );
}

/* ------------------------------------------------------------------- parts */

function MonthStepper({
  month,
  today,
  onChange,
}: {
  month: MonthKey;
  today: MonthKey;
  onChange: (month: MonthKey) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      {month !== today && (
        <button
          type="button"
          onClick={() => onChange(today)}
          className="mr-1 rounded-md px-2 py-1 text-[11px] font-medium text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
        >
          This month
        </button>
      )}
      <button
        type="button"
        onClick={() => onChange(shiftMonth(month, -1))}
        aria-label={`Go to ${monthName(shiftMonth(month, -1))}`}
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
      </button>
      {/* Fixed width so the arrows do not shuffle sideways between a short
          month name and a long one. */}
      <span className="w-[9.5rem] text-center text-[13px] font-medium text-zinc-200">
        {monthName(month)}
      </span>
      <button
        type="button"
        onClick={() => onChange(shiftMonth(month, 1))}
        aria-label={`Go to ${monthName(shiftMonth(month, 1))}`}
        className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white/[0.05] hover:text-zinc-100"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}

/**
 * The legend and the month's counts, which are the same row on purpose: a
 * legend nobody needs to look up twice is one that carries the number beside
 * the colour it explains.
 *
 * A state with none this month is DROPPED rather than shown as a zero. Five
 * zeroes on a quiet month is a row of noise, and the swatch means nothing when
 * there is nothing on the grid drawn in it.
 */
function Legend({
  counts,
  total,
  month,
}: {
  counts: Record<BookingState, number>;
  total: number;
  month: MonthKey;
}) {
  const shown = CALENDAR_STATES.filter((s) => counts[s.state] > 0);

  if (total === 0) {
    return (
      <p className="t-body text-zinc-400">
        No bookings on the calendar in {monthName(month)}.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="t-label text-zinc-400">
        {total} booking{total === 1 ? "" : "s"}
      </span>
      {shown.map((s) => (
        <span
          key={s.state}
          title={s.meaning}
          className="flex items-center gap-1.5 text-[12px] text-zinc-400"
        >
          <span className={cn("h-2 w-2 shrink-0 rounded-sm", SWATCH[s.state])} />
          <span className="font-mono tabular-nums text-zinc-200">
            {counts[s.state]}
          </span>
          {s.label}
        </span>
      ))}
    </div>
  );
}

function DayCell({
  day,
  month,
  today,
  entries,
  expanded,
  onExpand,
  onOpen,
}: {
  day: string;
  month: MonthKey;
  today: string;
  entries: CalendarEntry[];
  expanded: boolean;
  onExpand: () => void;
  onOpen: (booking: LinkedBooking) => void;
}) {
  const outside = day.slice(0, 7) !== month;
  const isToday = day === today;
  const visible = expanded ? entries : entries.slice(0, CHIPS_PER_CELL);
  const hidden = entries.length - visible.length;

  return (
    <div
      className={cn(
        "min-h-[6.5rem] p-1.5",
        // The padding days are drawn, not blanked: a call on the last Sunday
        // of the month before is still a call, and dropping it would make a
        // booking vanish at the month boundary.
        outside ? "bg-[#0a0a0c]" : "bg-[#0e0e11]"
      )}
    >
      <div className="mb-1 flex items-center justify-between px-0.5">
        <span
          className={cn(
            "font-mono text-[11px] tabular-nums",
            isToday
              ? "rounded bg-gold-500 px-1 font-semibold text-[var(--color-gold-ink)]"
              : outside
                ? "text-zinc-600"
                : "text-zinc-400"
          )}
        >
          {Number(day.slice(8, 10))}
        </span>
      </div>

      <div className="flex flex-col gap-0.5">
        {visible.map(({ booking, time }) => (
          <Chip
            key={booking.id}
            booking={booking}
            time={time}
            dim={outside}
            onOpen={onOpen}
          />
        ))}
        {hidden > 0 && (
          <button
            type="button"
            onClick={onExpand}
            className="px-1 py-0.5 text-left text-[11px] text-zinc-400 transition-colors hover:text-zinc-100"
          >
            +{hidden} more
          </button>
        )}
        {expanded && entries.length > CHIPS_PER_CELL && (
          <button
            type="button"
            onClick={onExpand}
            className="px-1 py-0.5 text-left text-[11px] text-zinc-400 transition-colors hover:text-zinc-100"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * One booking.
 *
 * A held call is a button that opens its scorecard; everything else is a
 * `div`, because there is nothing behind it to open and a control that does
 * nothing when you click it is worse than a label.
 */
function Chip({
  booking,
  time,
  dim,
  onOpen,
}: {
  booking: LinkedBooking;
  time: string | null;
  dim: boolean;
  onOpen: (booking: LinkedBooking) => void;
}) {
  const label = CALENDAR_STATES.find((s) => s.state === booking.state)?.label ?? "";
  const openable = booking.call_id !== null;
  const title = [
    time ? `${time} — ${booking.name || "Unknown"}` : booking.name || "Unknown",
    label,
    booking.event_type,
    booking.host ? `Host: ${booking.host}` : null,
    openable ? "Click to open the scorecard" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const body = (
    <>
      {time && (
        <span className="shrink-0 font-mono text-[10px] tabular-nums opacity-70">
          {time}
        </span>
      )}
      <span className="truncate">{booking.name || "Unknown"}</span>
      {/* WHAT STATE THIS IS, FOR ANYONE NOT READING THE COLOUR.
          Held, cancelled and no-show are told apart on this grid by fill and
          strikethrough alone, which is nothing at all to a screen reader and
          not much to a colour-blind reader either. `title` does not close the
          gap: on an element that already has text content it is not announced.
          So the word is in the markup, and hidden from sighted readers who
          have the colour already. */}
      <span className="sr-only">{label}</span>
    </>
  );

  const classes = cn(
    "flex w-full items-center gap-1 rounded-sm border-l-2 px-1 py-[3px] text-left text-[11px] leading-tight transition-colors",
    CHIP[booking.state],
    dim && "opacity-50",
    openable && "cursor-pointer hover:brightness-125"
  );

  if (!openable) {
    return (
      <div className={classes} title={title}>
        {body}
      </div>
    );
  }

  return (
    <button type="button" className={classes} title={title} onClick={() => onOpen(booking)}>
      {body}
    </button>
  );
}

/**
 * THE PHONE VIEW: the month as a list of the days that have something on them.
 *
 * Not a second copy of the data with different rules — it reads the same
 * grouping the grid does, including the padding days, so the two can never
 * disagree about which day a booking is on.
 */
function Agenda({
  month,
  days,
  grid,
  today,
  onOpen,
}: {
  month: MonthKey;
  days: Map<string, CalendarEntry[]>;
  grid: string[];
  today: string;
  onOpen: (booking: LinkedBooking) => void;
}) {
  const rows = grid
    .filter((day) => day.slice(0, 7) === month)
    .map((day) => ({ day, entries: days.get(day) ?? [] }))
    .filter((row) => row.entries.length > 0);

  if (rows.length === 0) return null;

  return (
    <div className="mt-4 space-y-3 sm:hidden">
      {rows.map(({ day, entries }) => (
        <div key={day}>
          <div
            className={cn(
              "mb-1 t-label",
              day === today ? "text-gold-400" : "text-zinc-400"
            )}
          >
            {longDate(day)}
            {day === today && " · today"}
          </div>
          <div className="flex flex-col gap-0.5">
            {entries.map(({ booking, time }) => (
              <Chip
                key={booking.id}
                booking={booking}
                time={time}
                dim={false}
                onOpen={onOpen}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Notice({
  tone,
  icon = false,
  children,
}: {
  tone: "amber" | "zinc";
  icon?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 t-body",
        tone === "amber"
          ? "border-amber-500/25 bg-amber-500/[0.06] text-amber-200"
          : "border-white/[0.08] bg-white/[0.03] text-zinc-400"
      )}
    >
      {icon && (
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" strokeWidth={1.5} />
      )}
      <p className="max-w-[80ch]">{children}</p>
    </div>
  );
}

/** `Mon 25 Aug`. UTC-parsed like every other plain date on the page. */
function longDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}
