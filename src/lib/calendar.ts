/**
 * THE MONTH GRID, AND WHAT DAY A BOOKING FALLS ON.
 *
 * Everything here is pure: dates in, dates out, no clock read and no network.
 * The component that draws the calendar owns which month is on screen; this
 * file owns what a month IS and which cell each booking belongs in.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE HAS ITS OWN TIMEZONE HANDLING, WHEN THE REST OF THE PAGE IS UTC
 *
 * `lib/periods.ts` reads and renders every date as UTC on purpose, and the
 * reasoning there is right: a `call_date` is a calendar day carrying no time,
 * so parsing it in the reader's own zone slides it either side of midnight
 * depending on who is looking.
 *
 * A booking is the other kind of value. It is an INSTANT — Calendly hands over
 * `2026-08-26T00:30:00Z` — and an instant only becomes a day once you say
 * whose day you mean. On the live account that exact time is a call at half
 * eight on the EVENING OF THE 25th for the team taking it, and printing it as
 * UTC puts it in the small hours of the following morning, one cell to the
 * right of where everyone involved remembers it. Measured on 2026-09-08:
 * 27 of 567 bookings in the read window fall on a different day under UTC.
 *
 * So the grid works in THE CLIENT'S BUSINESS DAY — `ClientConfig.timeZone`,
 * one answer for the whole client, the same one the ad spend and the call
 * dates are counted on — and the panel says which zone that is. The rest of
 * the page is untouched: nothing here is a denominator, and no rate is
 * computed from these groupings.
 *
 * WHICH ZONE IS NOT A DETAIL, AND THE NEAR MISSES ARE THE DANGEROUS ONES.
 * This first shipped reading the zone off the Calendly ACCOUNT, which is
 * whoever created the login — America/Chicago on Brey's, where the business
 * runs on America/New_York. One hour out. Nothing looks wrong: the times are
 * still working hours, and only the calls at either end of the day land on the
 * wrong square. An hour is harder to spot than five, which is why the source
 * has to be the business's own answer rather than the nearest zone to hand.
 */

import { LinkedBooking, BookingState } from "./bookings";

/** `2026-08` — a calendar month, which is what the grid is addressed by. */
export type MonthKey = string;

/* ------------------------------------------------------------------- zones */

/**
 * A zone we can actually format in. An account with a zone this build of Node
 * or this browser does not know still gets a calendar, drawn in UTC and
 * labelled UTC, rather than an exception halfway down the page.
 */
export function usableZone(zone: string | null | undefined): string {
  if (!zone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
    return zone;
  } catch {
    return "UTC";
  }
}

/**
 * Formatters are expensive to build and this is called once per booking per
 * render, so each zone's pair is built once and kept.
 */
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = dayFormatters.get(zone);
  if (!fmt) {
    // en-CA renders as YYYY-MM-DD, which is the shape every other date on this
    // page is stored and compared in — so the output slots straight into
    // `withinWindow` and friends without a second parse.
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(zone, fmt);
  }
  return fmt;
}

function timeFormatter(zone: string): Intl.DateTimeFormat {
  let fmt = timeFormatters.get(zone);
  if (!fmt) {
    // `hourCycle: "h23"` rather than `hour12: false`: the latter renders
    // midnight as 24:00 in several engines, which reads as tomorrow.
    fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    timeFormatters.set(zone, fmt);
  }
  return fmt;
}

/** The `YYYY-MM-DD` an instant falls on, in `zone`. Null if it will not parse. */
export function dayInZone(iso: string, zone: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return dayFormatter(zone).format(new Date(ms));
}

/** `14:30`, in `zone`. Null if it will not parse. */
export function timeInZone(iso: string, zone: string): string | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return timeFormatter(zone).format(new Date(ms));
}

/**
 * How a zone is named on screen: `America/New_York · GMT-4`.
 *
 * Both halves, because neither is enough on its own. The abbreviation is what
 * a person recognises; the IANA name is what they can check against Calendly,
 * and it does not change when the clocks do.
 */
export function zoneLabel(zone: string, on: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      timeZoneName: "short",
    }).formatToParts(on);
    const abbrev = parts.find((p) => p.type === "timeZoneName")?.value ?? null;
    return abbrev && abbrev !== zone ? `${zone} · ${abbrev}` : zone;
  } catch {
    return zone;
  }
}

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
    const day = dayInZone(booking.scheduled_at, zone);
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
