/**
 * Joining what was booked to what was recorded.
 *
 * A booking and a call are the same event seen from two sides: Calendly knows
 * every appointment that was ever made, Notion knows every one that produced a
 * recording. Laying them over each other is what turns "we recorded eleven
 * calls" into "fourteen were booked, one cancelled, two nobody turned up to".
 *
 * The one rule this module will not break: a booking with no recording is not
 * called a no-show. It might be one, or it might be a call that happened with
 * nobody recording it, and those two want opposite fixes — chase the prospect,
 * or fix the recorder. Unmatched bookings get their own state and are counted
 * in the open, so the gap is visible instead of being quietly resolved in
 * whichever direction flatters the number.
 */

import { BookingRecord, CalendlyFailure } from "./calendly";
import { CallRecord } from "./types";

/** How far apart a booking and a recording can sit and still be the same call. */
const MATCH_TOLERANCE_DAYS = 1;

/** Below this many hours of notice, a cancellation is a same-day drop. */
export const LATE_CANCEL_HOURS = 24;

/**
 * How much of the calendar has to be accounted for before a show rate is worth
 * stating as a single number.
 *
 * Every booking with no recording and no cancellation widens the true rate's
 * range by its own share. At 90% accounted for the range is ten points, which
 * is arguable; at 12% it spans almost everything, and quoting the midpoint —
 * or worse, the rate among only the accounted-for calls — would be inventing
 * precision the data does not have.
 */
export const MIN_COVERAGE_FOR_RATE = 90;


export type BookingState =
  /** Still ahead of us. Not a show or a no-show yet, so it counts as neither. */
  | "upcoming"
  /** Called off before it happened, by either side. */
  | "canceled"
  /** Went ahead and produced a recording. */
  | "kept"
  /** Nobody turned up — either Calendly says so, or the call was logged as one. */
  | "no_show"
  /** Due, not cancelled, and no recording found. Genuinely unknown. */
  | "unrecorded";

/**
 * How a booking was tied to a recording, strongest first, so a weaker tie can
 * always be seen for what it is rather than blending into the rest.
 */
export type MatchMethod = "email" | "name-and-date" | "one-name-and-date";

export interface LinkedBooking extends BookingRecord {
  state: BookingState;
  /** The Notion call this booking produced, when one was found. */
  call_id: string | null;
  /** Null when this booking produced no recording. */
  match_method: MatchMethod | null;
}

export interface BookingLink {
  bookings: LinkedBooking[];
  /** Booking by Notion call id, for showing a call's pre-call context. */
  byCallId: Record<string, LinkedBooking>;
}

/**
 * What the page knows about Calendly this request. Lives here rather than in
 * the page so the client component can import the type without pulling a
 * server module in with it.
 */
export interface CalendlyState {
  /** Null when Calendly is not connected, which is the normal starting state. */
  link: BookingLink | null;
  /** The earliest booking this read covers, so the panels can say so. */
  windowStart: string | null;
  /** Set when Calendly is connected but the read failed. */
  failure: CalendlyFailure | null;
  /**
   * Bookings still being read from Calendly. Above zero nothing derived from
   * the set is quoted as a rate — a funnel measured on half the bookings is
   * not a small error, it is a different number.
   */
  pending: number;
  /** Sales bookings in the window, read or not. */
  total: number;
}

/* ------------------------------------------------------------------ dates */

/** Whole days since the epoch, in UTC. Works on dates and datetimes alike. */
function dayIndex(value: string): number | null {
  const ms = Date.parse(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 864e5);
}

/** The YYYY-MM-DD a booking's start time falls on, for filtering by window. */
export function bookingDate(booking: BookingRecord): string {
  return booking.scheduled_at.slice(0, 10);
}

/* ---------------------------------------------------------------- matching */

type Pair = {
  booking: BookingRecord;
  call: CallRecord;
  distance: number;
  method: MatchMethod;
};

/**
 * The parts of a person's name worth comparing. Two-letter fragments and
 * punctuation are dropped, so "Saul m Hernandez" compares on saul/hernandez.
 */
function nameTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

/** How many name parts two names share. */
function sharedNameParts(a: string, b: string): number {
  const left = new Set(nameTokens(a));
  return nameTokens(b).filter((t) => left.has(t)).length;
}

/**
 * Ties each booking to at most one recording, and each recording to at most
 * one booking.
 *
 * Matching runs on email and then on how close the two sit in time, nearest
 * pair first. The nearest-first pass is what makes a repeat prospect come out
 * right: someone who books, no-shows, rebooks and then buys has two bookings
 * and one recording, and greedily taking the closest pair leaves the no-show
 * unmatched instead of attaching the recording to whichever booking happened
 * to be read first.
 */
function matchBookingsToCalls(
  bookings: BookingRecord[],
  calls: CallRecord[]
): Map<string, { callId: string; method: MatchMethod }> {
  const callsByEmail = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const email = callEmail(call);
    if (!email) continue;
    const bucket = callsByEmail.get(email);
    if (bucket) bucket.push(call);
    else callsByEmail.set(email, [call]);
  }

  const pairs: Pair[] = [];
  for (const booking of bookings) {
    const bookingDay = dayIndex(booking.scheduled_at);
    if (bookingDay == null) continue;

    for (const call of callsByEmail.get(booking.email) ?? []) {
      if (!call.call_date) continue;
      const callDay = dayIndex(call.call_date);
      if (callDay == null) continue;
      const distance = Math.abs(callDay - bookingDay);
      if (distance <= MATCH_TOLERANCE_DAYS) {
        pairs.push({ booking, call, distance, method: "email" });
      }
    }
  }

  pairs.push(...nameAndDatePairs(bookings, calls));

  // Strongest tie first, always. An address is an identifier, a full name on a
  // day is a strong inference, a first name on a day is a weak one — and a
  // weaker tie must never take a booking that a stronger one wanted.
  const ORDER: Record<MatchMethod, number> = {
    email: 0,
    "name-and-date": 1,
    "one-name-and-date": 2,
  };
  const rank = (p: Pair) => ORDER[p.method];
  pairs.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.distance - b.distance ||
      a.booking.scheduled_at.localeCompare(b.booking.scheduled_at)
  );

  const bookingToCall = new Map<string, { callId: string; method: MatchMethod }>();
  const takenCalls = new Set<string>();
  for (const pair of pairs) {
    if (bookingToCall.has(pair.booking.id) || takenCalls.has(pair.call.id)) continue;
    bookingToCall.set(pair.booking.id, { callId: pair.call.id, method: pair.method });
    takenCalls.add(pair.call.id);
  }

  return bookingToCall;
}

/**
 * The fallback for calls whose email never made it onto the row.
 *
 * The workflow fills `Prospect Email` from the calendar invite, and on a live
 * account most Calendly-booked calls arrive without one — the invite does not
 * always carry the invitee as an addressable attendee. Those rows would
 * otherwise be unmatchable, and the funnel would report a real, working
 * calendar as producing no calls at all.
 *
 * So a call with no email may be tied to a booking on the strength of the name
 * and the day. Two strengths of tie, kept apart because they do not deserve the
 * same confidence:
 *
 * - **Both name parts agree** on the same day. First and last name together is
 *   about as good as an address.
 * - **One name part agrees** on the same day, and it is the only booking that
 *   day matching any part of that name. Weaker, and used because on a real
 *   tracker most call titles are a bare first name — the meeting title is
 *   whatever the closer typed. Discarding those threw away a third of the
 *   calendar's overlap with the tracker.
 *
 * Both require **exactly one candidate on each side**. Two bookings that fit
 * one call, or two calls that fit one booking, are left unmatched rather than
 * resolved by guessing — on twenty bookings a day, a repeated first name is the
 * likely case, not the rare one.
 *
 * Both apply **only when the call has no email at all**. A call that has one
 * and did not match is telling us something — the wrong address was captured,
 * or the prospect came another way — and papering over it with a name would
 * bury the signal.
 */
function nameAndDatePairs(bookings: BookingRecord[], calls: CallRecord[]): Pair[] {
  const emaillessCalls = calls.filter(
    (c) => !callEmail(c) && c.call_date && c.name.trim() !== ""
  );
  if (emaillessCalls.length === 0) return [];

  const candidates = new Map<string, Pair[]>();
  for (const call of emaillessCalls) {
    const callDay = dayIndex(call.call_date as string);
    if (callDay == null) continue;

    const sameDay = bookings.filter((b) => dayIndex(b.scheduled_at) === callDay);
    const shared = sameDay.map((booking) => ({
      booking,
      parts: sharedNameParts(call.name, booking.name),
    }));

    const both = shared.filter((s) => s.parts >= 2);
    const any = shared.filter((s) => s.parts >= 1);

    // The strong tie wins outright. The weak one is only reached when there is
    // no strong candidate at all, and only when it stands alone on the day.
    const chosen =
      both.length > 0
        ? both.map((s) => ({ booking: s.booking, method: "name-and-date" as const }))
        : any.map((s) => ({
            booking: s.booking,
            method: "one-name-and-date" as const,
          }));

    candidates.set(
      call.id,
      chosen.map(({ booking, method }) => ({ booking, call, distance: 0, method }))
    );
  }

  // Drop anything ambiguous from either direction before returning.
  const unique = [...candidates.values()].filter((list) => list.length === 1).flat();
  const bookingCounts = new Map<string, number>();
  for (const pair of unique) {
    bookingCounts.set(pair.booking.id, (bookingCounts.get(pair.booking.id) ?? 0) + 1);
  }
  return unique.filter((pair) => bookingCounts.get(pair.booking.id) === 1);
}

/**
 * The prospect's email as the tracker holds it.
 *
 * Notion has no email column the dashboard reads today — `Prospect Email` is
 * written by the workflow for exactly this kind of join but never surfaced —
 * so this is the one place that reaches for it, and it tolerates its absence.
 */
function callEmail(call: CallRecord): string | null {
  const email = (call.prospect_email ?? "").trim().toLowerCase();
  return email === "" ? null : email;
}

/* ----------------------------------------------------------- classifying */

function classify(
  booking: BookingRecord,
  call: CallRecord | undefined,
  now: Date
): BookingState {
  // A recording outranks anything the calendar says about itself. If there is a
  // conversation on file then somebody turned up, whatever a checkbox in
  // Calendly says — including the cancelled flag, which people set after the
  // fact often enough to matter.
  if (call) return call.outcome === "No show" ? "no_show" : "kept";

  if (booking.status === "canceled") return "canceled";
  if (Date.parse(booking.scheduled_at) > now.getTime()) return "upcoming";
  if (booking.marked_no_show) return "no_show";
  return "unrecorded";
}

export function linkBookings(
  bookings: BookingRecord[],
  calls: CallRecord[],
  now: Date = new Date()
): BookingLink {
  const bookingToCall = matchBookingsToCalls(bookings, calls);
  const callsById = new Map(calls.map((c) => [c.id, c]));

  const linked: LinkedBooking[] = bookings.map((booking) => {
    const match = bookingToCall.get(booking.id) ?? null;
    const call = match ? callsById.get(match.callId) : undefined;
    return {
      ...booking,
      state: classify(booking, call, now),
      call_id: match?.callId ?? null,
      match_method: match?.method ?? null,
    };
  });

  // A plain object rather than a Map, because this crosses from the server
  // component into the client one and a Map does not survive that trip.
  const byCallId: Record<string, LinkedBooking> = {};
  for (const booking of linked) {
    if (booking.call_id) byCallId[booking.call_id] = booking;
  }

  return { bookings: linked, byCallId };
}

/* ------------------------------------------------------------- the funnel */

export interface FunnelStats {
  /** Every past booking, cancellations included. What was on the calendar. */
  booked: number;
  canceled: number;
  kept: number;
  noShow: number;
  /** Due, not cancelled, no recording. The honest unknown. */
  unrecorded: number;
  upcoming: number;

  /**
   * Kept against kept-plus-no-show — of the calls we know the fate of, how
   * many happened. Null until something has been accounted for.
   */
  showRate: number | null;
  /**
   * The same rate if every unaccounted booking turns out to be a show, and if
   * every one turns out to be a no-show. The true number is inside this range,
   * and the range closes as recording coverage improves.
   */
  showRateRange: { low: number; high: number } | null;
  /** Share of due bookings whose fate is known at all. */
  coverage: number | null;
  /** Kept against everything booked — what cancellations cost on top. */
  heldRate: number | null;

  /** Cancellations that landed inside a day of the call, but before it. */
  lateCancels: number;
  /**
   * Cancellations recorded *after* the call was due to start.
   *
   * Not a cancellation in any useful sense — nobody called anything off in
   * advance. Teams commonly clear a no-show off the calendar by cancelling it
   * afterwards, so counting these as cancellations both overstates the
   * cancellations and hides the no-shows.
   */
  canceledAfterStart: number;
  /** Cancellations the prospect made. */
  canceledByInvitee: number;
  /** Cancellations made by the team's own side. */
  canceledByHost: number;
  /** Median hours of notice, over cancellations made before the call was due. */
  medianCancelNotice: number | null;

  /** Recorded calls with no booking behind them. */
  callsWithoutBooking: number;
  /**
   * Bookings tied to a call by name and date rather than by email. Weaker ties,
   * so they are counted and shown rather than blended into the rest — and the
   * first-name-only ones are counted apart from the full-name ones again.
   */
  matchedByName: number;
  matchedByFirstNameOnly: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * The funnel over one window.
 *
 * Takes the two filtered lists rather than the whole link, because the
 * dashboard's date range and closer filter narrow both, and a funnel measured
 * on a different window from the KPI cards above it would be worse than no
 * funnel at all.
 */
export function funnelStats(
  bookings: LinkedBooking[],
  calls: CallRecord[]
): FunnelStats {
  const counts = { kept: 0, noShow: 0, canceled: 0, unrecorded: 0, upcoming: 0 };
  for (const booking of bookings) {
    if (booking.state === "kept") counts.kept++;
    else if (booking.state === "no_show") counts.noShow++;
    else if (booking.state === "canceled") counts.canceled++;
    else if (booking.state === "unrecorded") counts.unrecorded++;
    else counts.upcoming++;
  }

  const booked = counts.kept + counts.noShow + counts.canceled + counts.unrecorded;
  const due = counts.kept + counts.noShow + counts.unrecorded;
  const accounted = counts.kept + counts.noShow;

  const canceledBookings = bookings.filter((b) => b.state === "canceled");
  const notice = canceledBookings
    .map((b) => b.cancel_notice_hours)
    .filter((h): h is number => h != null);
  // Notice given before the call was due. The negative ones are a different
  // event entirely and are reported on their own rather than averaged in.
  const noticeBefore = notice.filter((h) => h >= 0);

  const bookedCallIds = new Set(
    bookings.map((b) => b.call_id).filter((id): id is string => id != null)
  );

  return {
    booked,
    canceled: counts.canceled,
    kept: counts.kept,
    noShow: counts.noShow,
    unrecorded: counts.unrecorded,
    upcoming: counts.upcoming,

    showRate: accounted === 0 ? null : (counts.kept / accounted) * 100,
    showRateRange:
      due === 0
        ? null
        : {
            low: (counts.kept / due) * 100,
            high: ((counts.kept + counts.unrecorded) / due) * 100,
          },
    coverage: due === 0 ? null : (accounted / due) * 100,
    heldRate: booked === 0 ? null : (counts.kept / booked) * 100,

    lateCancels: noticeBefore.filter((h) => h < LATE_CANCEL_HOURS).length,
    canceledAfterStart: notice.filter((h) => h < 0).length,
    canceledByInvitee: canceledBookings.filter(
      (b) => b.canceled_by_side === "invitee"
    ).length,
    canceledByHost: canceledBookings.filter((b) => b.canceled_by_side === "host")
      .length,
    medianCancelNotice: median(noticeBefore),

    callsWithoutBooking: calls.filter((c) => !bookedCallIds.has(c.id)).length,
    matchedByName: bookings.filter((b) => b.match_method === "name-and-date").length,
    matchedByFirstNameOnly: bookings.filter(
      (b) => b.match_method === "one-name-and-date"
    ).length,
  };
}

/* ---------------------------------------------------------- booking lead time */

/* -------------------------------------------------------------- attribution */

/**
 * Where the booking came from, according to the link they booked through.
 *
 * The tracker's own `Lead Source` is the scorer's reading of what the prospect
 * said on the call, which is a guess made after the fact and only exists for
 * calls that happened. A utm tag on the booking link is a fact, recorded
 * before anyone spoke, and it exists for no-shows too.
 */
export function bookingSource(booking: BookingRecord): string | null {
  return booking.tracking.source;
}

export interface SourceStat {
  source: string;
  booked: number;
  kept: number;
  noShow: number;
  showRate: number | null;
}

/** Booked-versus-showed per utm source, which the call table cannot see. */
export function sourceStats(bookings: LinkedBooking[]): SourceStat[] {
  const bySource = new Map<string, LinkedBooking[]>();
  for (const booking of bookings) {
    if (booking.state === "upcoming") continue;
    const source = bookingSource(booking) ?? "Untagged";
    const bucket = bySource.get(source);
    if (bucket) bucket.push(booking);
    else bySource.set(source, [booking]);
  }

  return [...bySource.entries()]
    .map(([source, list]) => {
      const kept = list.filter((b) => b.state === "kept").length;
      const noShow = list.filter((b) => b.state === "no_show").length;
      const accounted = kept + noShow;
      return {
        source,
        booked: list.length,
        kept,
        noShow,
        showRate: accounted === 0 ? null : (kept / accounted) * 100,
      };
    })
    .sort((a, b) => b.booked - a.booked);
}

/**
 * Calls where Calendly's assigned host and the closer credited by the
 * recording are different people.
 *
 * Fathom credit goes to whichever internal person spoke most, which is a good
 * guess and occasionally the wrong one — a manager sitting in on a call can
 * take it. Calendly says who the booking was assigned to, so the two
 * disagreeing is worth naming rather than silently preferring one.
 *
 * The catch is that a Calendly host is often not a person. Teams run bookings
 * through shared accounts — "Advisor Coach", "Enrollment Team" — and comparing
 * one of those to a closer's name reports a disagreement on every single call,
 * which is worse than reporting none. So a host only counts as a person here
 * if their name matches somebody who actually closes on this tracker; anything
 * else is treated as an account, not a mismatch.
 */
export function closerDisagreements(
  bookings: LinkedBooking[],
  calls: CallRecord[]
): { call: CallRecord; assigned: string; credited: string }[] {
  const callsById = new Map(calls.map((c) => [c.id, c]));

  // Every closer on file, by name part, so "Tpan A" and "Tpan" are one person.
  const closerTokens = new Map<string, string>();
  for (const call of calls) {
    if (!call.closer) continue;
    for (const token of nameTokens(call.closer)) closerTokens.set(token, call.closer);
  }

  const asCloser = (host: string): string | null => {
    for (const token of nameTokens(host)) {
      const known = closerTokens.get(token);
      if (known) return known;
    }
    return null;
  };

  const out: { call: CallRecord; assigned: string; credited: string }[] = [];
  for (const booking of bookings) {
    if (!booking.call_id || !booking.host) continue;
    const call = callsById.get(booking.call_id);
    if (!call?.closer) continue;

    const assigned = asCloser(booking.host);
    // Not a name we recognise as a closer — a shared booking account. Nothing
    // to disagree with.
    if (!assigned) continue;
    if (assigned !== call.closer) {
      out.push({ call, assigned: booking.host, credited: call.closer });
    }
  }

  return out;
}
