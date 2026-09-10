/**
 * THE MONTH GRID, AND WHAT DAY A BOOKING FALLS ON.
 *
 * Everything here is pure: dates in, dates out, no clock read and no network.
 * The component that draws the calendar owns which month is on screen; this
 * file owns what a month IS and which cell each booking belongs in.
 *
 * ---------------------------------------------------------------------------
 * WHOSE DAY A BOOKING FALLS ON IS NOT DECIDED HERE ANY MORE
 *
 * It used to be. This file owned the zone helpers, and its header explained at
 * length why the grid could not read a Calendly instant as UTC — then closed
 * with "the rest of the page is untouched: nothing here is a denominator". The
 * grid was untouched; the page was not. `lib/bookings.ts` was doing the same
 * conversion with `slice(0, 10)` to decide which booking belongs to which call.
 *
 * So the rule moved to `lib/business-day.ts`, which both read, and every
 * booking now arrives here already carrying its `business_day`. See that file
 * for the two September calls that were joined to the wrong slot before it did.
 */

import { LinkedBooking, BookingState } from "./bookings";
import { dayInZone, timeInZone } from "./business-day";
// Re-exported rather than redefined: the calendar was the first reader of these
// and its component imports them from here, but the definition is shared now.
export { usableZone, dayInZone, timeInZone, zoneLabel } from "./business-day";

/** `2026-08` — a calendar month, which is what the grid is addressed by. */
export type MonthKey = string;

/* ------------------------------------------------------------------- months */

/** The month a `YYYY-MM-DD` falls in. */
export function monthOf(day: string): MonthKey {
  return day.slice(0, 7);
}

/** `2026-08` shifted by `by` months, forwards or back. */
export function shiftMonth(month: MonthKey, by: number): MonthKey {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1;
  const d = new Date(Date.UTC(year, index + by, 1));
  return d.toISOString().slice(0, 7);
}

/** `August 2026`. */
export function monthName(month: MonthKey): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** First and last day of a month, inclusive, as `YYYY-MM-DD`. */
export function monthBounds(month: MonthKey): { first: string; last: string } {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7));
  return {
    first: `${month}-01`,
    last: new Date(Date.UTC(year, index, 0)).toISOString().slice(0, 10),
  };
}

/**
 * Every cell in the month's grid, Monday first, padded out to whole weeks with
 * the days either side.
 *
 * The padding days are real dates rather than blanks, so a call on the last
 * Sunday of July is DRAWN when you are looking at August rather than silently
 * dropped — it is dimmed instead, which is how a wall calendar behaves and
 * what stops a booking disappearing at a month boundary.
 *
 * Monday first because `weekStart` in lib/periods.ts is Monday-first and the
 * audience is British; two week shapes on one page would be worse than either.
 */
export function monthGrid(month: MonthKey): string[] {
  const { first, last } = monthBounds(month);
  const start = new Date(`${first}T00:00:00Z`);
  // getUTCDay is Sunday-0; this maps Monday to 0.
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));

  const end = new Date(`${last}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 6) % 7)));

  const days: string[] = [];
  for (const d = start; d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/* ----------------------------------------------------------------- grouping */

/** A booking placed on a day, with its start time already rendered. */
export interface CalendarEntry {
  booking: LinkedBooking;
  /** `14:30` in the calendar's zone, or null when the timestamp was unusable. */
  time: string | null;
}

/**
 * Bookings by day, each day's list in the order the calls were due.
 *
 * THE DAY IS THE ONE THE BOOKING ARRIVES CARRYING, not one worked out here.
 * `linkBookings` stamps `business_day` on every booking, in the client's zone,
 * and the matcher and the window filter read that same field — so the cell a
 * booking is drawn in and the period it is counted in can no longer disagree.
 * They did: the grid used this zone and `lib/bookings.ts` used UTC, and 4.7% of
 * the live calendar sat on different days under the two. See lib/business-day.ts.
 *
 * `zone` is still taken, for the time label on each chip.
 *
 * Bookings whose timestamp will not parse are dropped rather than piled onto
 * an arbitrary day — `dropped` says how many, so the panel can admit it
 * instead of quietly showing a shorter calendar.
 */
export function groupByDay(
  bookings: LinkedBooking[],
  zone: string
): { days: Map<string, CalendarEntry[]>; dropped: number } {
  const days = new Map<string, CalendarEntry[]>();
  let dropped = 0;

  for (const booking of bookings) {
    const day = booking.business_day;
    if (day === null) {
      dropped++;
      continue;
    }
    const entry: CalendarEntry = {
      booking,
      time: timeInZone(booking.scheduled_at, zone),
    };
    const existing = days.get(day);
    if (existing) existing.push(entry);
    else days.set(day, [entry]);
  }

  for (const entries of days.values()) {
    entries.sort((a, b) => a.booking.scheduled_at.localeCompare(b.booking.scheduled_at));
  }

  return { days, dropped };
}

/* ------------------------------------------------------------------- states */

/**
 * THE FIVE THINGS A BOOKING CAN BE, in the order they are legended.
 *
 * `unrecorded` is deliberately not called a no-show, here or anywhere else in
 * this codebase: a booking with no recording behind it is either somebody who
 * did not turn up or a call nobody hit record on, and those want opposite
 * fixes. See the header of lib/bookings.ts.
 */
export const CALENDAR_STATES: {
  state: BookingState;
  label: string;
  /** What it means, in one line, for the legend's tooltip. */
  meaning: string;
}[] = [
  { state: "kept", label: "Held", meaning: "Went ahead and produced a recording." },
  { state: "upcoming", label: "Upcoming", meaning: "Still ahead of us." },
  {
    state: "unrecorded",
    label: "Not recorded",
    meaning:
      "Due, not cancelled, and no recording found. Either nobody turned up or " +
      "nobody recorded it — this page will not guess which.",
  },
  {
    state: "no_show",
    label: "No-show",
    meaning: "Marked as a no-show in Calendly, or logged as one on the tracker.",
  },
  { state: "canceled", label: "Cancelled", meaning: "Called off, by either side." },
];

/** How many bookings in each state. Every state is a key, including the zeroes. */
export function stateCounts(
  bookings: LinkedBooking[]
): Record<BookingState, number> {
  const counts: Record<BookingState, number> = {
    kept: 0,
    upcoming: 0,
    unrecorded: 0,
    no_show: 0,
    canceled: 0,
  };
  for (const b of bookings) counts[b.state]++;
  return counts;
}

/* -------------------------------------------------------------- read window */

/**
 * HOW MUCH OF THIS MONTH THE CALENDAR ACTUALLY READ.
 *
 * Calendly is read over a window — ninety days back by default, a year ahead —
 * and a month outside it comes back empty for a reason that is not "nothing
 * was booked". The two must never render the same, which is the same rule the
 * `reading` flag exists for one layer up.
 */
export type MonthCoverage =
  /** The whole month is inside the read window. */
  | { kind: "covered" }
  /** Read from `from` onwards; anything before it was never fetched. */
  | { kind: "partial"; from: string }
  /** Entirely before the window. Nothing here was ever asked for. */
  | { kind: "unread" };

/**
 * `zone` is not optional decoration. `windowStart` is an INSTANT, and the grid
 * it is being compared against is a set of days in the account's zone — so
 * turning it into a day with a UTC slice puts the boundary a day out for any
 * window that opens in the evening, which is most of them: the window is
 * "ninety days before this moment", and that moment is whenever the process
 * last started. Read in the same zone as the cells, the notice names the day a
 * reader can actually find on the grid.
 */
export function monthCoverage(
  month: MonthKey,
  windowStart: string | null,
  zone: string
): MonthCoverage {
  if (!windowStart) return { kind: "covered" };
  const start = dayInZone(windowStart, zone);
  if (start === null) return { kind: "covered" };
  const { first, last } = monthBounds(month);
  if (start <= first) return { kind: "covered" };
  if (start > last) return { kind: "unread" };
  return { kind: "partial", from: start };
}
