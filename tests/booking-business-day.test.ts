/**
 * WHOSE DAY A BOOKING FALLS ON, AND THE TWO CALLS THAT GOT IT WRONG.
 *
 * Found on Brey's live account, 2026-09-10. A Calendly `scheduled_at` is an
 * instant in UTC; a Notion `Call Date` is the client's own day. `lib/bookings.ts`
 * turned the first into a day with `slice(0, 10)`, so every call after 20:00
 * New York sat one day away from its own booking — 27 of 574 live bookings.
 *
 * The cost was not a rounding error. The same-day name fallback could not see
 * the real booking, so it matched the call to the slot the prospect had
 * RESCHEDULED AWAY FROM; that slot then carried a recording, stopped counting
 * as a cancellation, and escaped the "a moved slot is not a second booking"
 * subtraction. `booked` read 53 where the rule intends 51.
 *
 * Every case below is written from the live rows, at the live times, and each
 * one is checked BOTH WAYS — with the client's zone and with the UTC fallback —
 * so a revert cannot leave the suite green. A fixture written at midday could
 * not tell the two rules apart at all, which is why nothing here is at midday.
 */
import { describe, it, expect } from "vitest";
import { linkBookings, funnelStats, bookingDate } from "../src/lib/bookings";
import { businessDay } from "../src/lib/business-day";
import { BookingRecord } from "../src/lib/calendly";
import { call } from "./helpers";

/** The client's business zone. Not the Calendly login's, not the server's. */
const BUSINESS = "America/New_York";

/** Well after every fixture date, so nothing counts as upcoming. */
const NOW = new Date("2026-09-20T00:00:00Z");

let seq = 0;
function booking(over: Partial<BookingRecord> = {}): BookingRecord {
  seq += 1;
  return {
    id: `inv-${seq}`,
    event_id: `evt-${seq}`,
    event_type: "Profitability Game Plan Call Team",
    name: `Prospect ${seq}`,
    email: `p${seq}@example.com`,
    booked_at: "2026-09-01T10:00:00Z",
    scheduled_at: "2026-09-04T23:00:00Z",
    lead_time_days: 3,
    status: "active",
    canceled_by_side: null,
    canceled_by: null,
    cancel_reason: null,
    canceled_at: null,
    cancel_notice_hours: null,
    marked_no_show: false,
    rescheduled: false,
    host: "Success Team",
    host_email: "success@example.com",
    tracking: { source: null, medium: null, campaign: null, content: null, term: null },
    answers: [],
    ...over,
  } as BookingRecord;
}

/** Calendly's own shape for a slot the invitee moved: cancelled by the host. */
function movedSlot(over: Partial<BookingRecord> = {}): BookingRecord {
  return booking({
    status: "canceled",
    rescheduled: true,
    canceled_by_side: "host",
    cancel_reason: "Rescheduled from connected calendar event",
    canceled_at: "2026-09-04T12:00:00Z",
    cancel_notice_hours: 11,
    ...over,
  });
}

describe("the day an evening booking is filed under", () => {
  // 4 September, 21:00 New York — one of the live times. In UTC that is one
  // o'clock the following morning.
  const ninePmOnTheFourth = "2026-09-05T01:00:00Z";

  it("is the day the team worked, not the day UTC names", () => {
    expect(businessDay(ninePmOnTheFourth, BUSINESS)).toBe("2026-09-04");
    // Stated rather than implied, so the difference is on the page: this is
    // exactly what the old slice returned, and what the fix exists to stop.
    expect(ninePmOnTheFourth.slice(0, 10)).toBe("2026-09-05");
  });

  it("is what the window filter reads off the booking", () => {
    const [inZone] = linkBookings(
      [booking({ scheduled_at: ninePmOnTheFourth })],
      [],
      { timeZone: BUSINESS, now: NOW }
    ).bookings;
    expect(bookingDate(inZone)).toBe("2026-09-04");

    // With no zone configured it falls back to UTC — worse, and deliberately
    // still the old answer, so the fallback is a stated choice rather than a
    // silent one.
    const [noZone] = linkBookings(
      [booking({ scheduled_at: ninePmOnTheFourth })],
      [],
      { now: NOW }
    ).bookings;
    expect(bookingDate(noZone)).toBe("2026-09-05");
  });

  it("leaves a midday booking alone, so the fix cannot move a normal call", () => {
    const midday = "2026-09-04T15:00:00Z";
    expect(businessDay(midday, BUSINESS)).toBe("2026-09-04");
    expect(midday.slice(0, 10)).toBe("2026-09-04");
  });

  it("does not touch a Call Date that is already a bare day", () => {
    // periods.ts reads days as UTC on purpose; parsing one in a zone would
    // hand midnight to whoever is looking and slide it either side.
    expect(businessDay("2026-09-04", BUSINESS)).toBe("2026-09-04");
  });
});

/**
 * THE LIVE ROW. Mike Totall, 4 September.
 *
 * A 19:00 slot the prospect moved, a 21:00 replacement he attended, and one
 * recording at 20:55. The tracker row carries no email — 16 of September's 26
 * did not — so the join runs on the name-and-day fallback, which requires the
 * SAME day and therefore could not see the 21:00 booking at all.
 */
describe("a call joined to a slot the prospect had already moved", () => {
  const recorded = call({
    id: "call-totall",
    name: "Mike Totall",
    prospect_email: null,
    call_date: "2026-09-04",
    outcome: "No show",
  });

  const moved = movedSlot({
    id: "inv-moved",
    name: "Thomas Totall",
    email: "totaltaxes@example.com",
    // 19:00 New York on the 4th.
    scheduled_at: "2026-09-04T23:00:00Z",
  });
  const replacement = booking({
    id: "inv-replacement",
    name: "Thomas Totall",
    email: "totaltaxes@example.com",
    // 21:00 New York on the 4th — the one that happened.
    scheduled_at: "2026-09-05T01:00:00Z",
  });

  it("joins the recording to the slot that actually happened", () => {
    const link = linkBookings([moved, replacement], [recorded], {
      timeZone: BUSINESS,
      now: NOW,
    });
    const byId = new Map(link.bookings.map((b) => [b.id, b]));
    expect(byId.get("inv-replacement")?.call_id).toBe("call-totall");
    expect(byId.get("inv-moved")?.call_id).toBeNull();
    // And the moved slot stays what it is: a cancellation, not a no-show.
    expect(byId.get("inv-moved")?.state).toBe("canceled");
  });

  /**
   * The zone alone is not enough, and this is the half that says so.
   *
   * With both bookings correctly on the 4th, the name fallback sees TWO
   * candidates for one call and — rightly — refuses to guess. Honest, and the
   * call is still lost. Excluding the slot the prospect moved away from is what
   * leaves exactly one candidate, so the two fixes are load-bearing together.
   */
  it("refuses nothing, because the abandoned slot is not a candidate at all", () => {
    const link = linkBookings([moved, replacement], [recorded], {
      timeZone: BUSINESS,
      now: NOW,
    });
    const matched = link.bookings.filter((b) => b.call_id !== null);
    expect(matched.map((b) => b.id)).toEqual(["inv-replacement"]);
  });

  it("counts the two rows as one request for a call", () => {
    const stats = funnelStats(
      linkBookings([moved, replacement], [recorded], {
        timeZone: BUSINESS,
        now: NOW,
      }).bookings,
      [recorded]
    );
    expect(stats.rescheduledAway).toBe(1);
    expect(stats.booked).toBe(1);
  });

  /**
   * THE PROOF THE TESTS ABOVE CAN FAIL.
   *
   * Read as UTC the replacement moves to the 5th, so the call's own day holds
   * no booking it can be joined to and the call is orphaned. The calendar then
   * shows a 21:00 slot nobody recorded beside a recording nobody booked.
   *
   * Before the abandoned slot was excluded from matching, this was worse than
   * an orphan: the 19:00 row was the only candidate left on the 4th, so it took
   * the recording, stopped being a cancellation, and one prospect who booked
   * twice read as two. Both fixes are needed, and this is why.
   */
  it("read as UTC, cannot find the booking its own call sits on", () => {
    const link = linkBookings([moved, replacement], [recorded], { now: NOW });
    const byId = new Map(link.bookings.map((b) => [b.id, b]));
    expect(byId.get("inv-replacement")?.business_day).toBe("2026-09-05");
    expect(link.bookings.every((b) => b.call_id === null)).toBe(true);
  });
});

/**
 * A SLOT "RESCHEDULED" AFTER IT WAS DUE IS A CALL THAT HAPPENED.
 *
 * Excluding every rescheduled-away slot from matching broke three live joins —
 * Wincho, Pluto's 27 August and Jaden Pierce — because Calendly marks the
 * original cancelled-because-rescheduled whether the prospect moved it in
 * advance or the team rebooked from inside the meeting. Their notice figures
 * were −0.49h, −0.16h and −0.80h: the "move" landed ten to fifty minutes AFTER
 * the call had started. 31 of the 105 rescheduled slots in the live read are
 * this shape, so it is the common case, not an edge one.
 */
describe("a slot rebooked from inside the meeting", () => {
  const recorded = call({
    id: "call-wincho",
    name: "Wincho",
    prospect_email: "wincho@example.com",
    call_date: "2026-08-11",
    outcome: "BAMFAM",
  });

  // Held at 17:00, "rescheduled" at 17:29 — half an hour after it started.
  const held = movedSlot({
    id: "inv-held",
    name: "Wincho",
    email: "wincho@example.com",
    scheduled_at: "2026-08-11T21:00:00Z",
    canceled_at: "2026-08-11T21:29:21Z",
    cancel_notice_hours: -0.49,
  });

  it("still holds its recording, because the call had already happened", () => {
    const link = linkBookings([held], [recorded], {
      timeZone: BUSINESS,
      now: NOW,
    });
    expect(link.bookings[0].call_id).toBe("call-wincho");
  });

  it("is still excluded when the move came BEFORE the call was due", () => {
    // Same row, moved two hours ahead of time. Now nobody attended it.
    const inAdvance = movedSlot({
      id: "inv-in-advance",
      name: "Wincho",
      email: "wincho@example.com",
      scheduled_at: "2026-08-11T21:00:00Z",
      canceled_at: "2026-08-11T19:00:00Z",
      cancel_notice_hours: 2,
    });
    const link = linkBookings([inAdvance], [recorded], {
      timeZone: BUSINESS,
      now: NOW,
    });
    expect(link.bookings[0].call_id).toBeNull();
  });

  it("is excluded when Calendly recorded no cancellation time at all", () => {
    // The weaker claim of the two: unknown is read as "decided in advance",
    // never as "so it must have been held".
    const noTime = movedSlot({
      id: "inv-no-time",
      name: "Wincho",
      email: "wincho@example.com",
      scheduled_at: "2026-08-11T21:00:00Z",
      canceled_at: null,
      cancel_notice_hours: null,
    });
    const link = linkBookings([noTime], [recorded], {
      timeZone: BUSINESS,
      now: NOW,
    });
    expect(link.bookings[0].call_id).toBeNull();
  });
});

/**
 * THE OTHER LIVE ROW. Pluto, 1 September.
 *
 * This one has an email, so it joins on the address — and the ±1 day tolerance
 * hides the zone error rather than tripping over it. What it cannot hide is
 * WHICH booking wins: a 31 August evening slot the prospect moved reads as
 * 1 September in UTC, ties on distance, and is taken first.
 */
describe("a booking from the evening before", () => {
  const recorded = call({
    id: "call-pluto",
    name: "Pluto",
    prospect_email: "pluto@example.com",
    call_date: "2026-09-01",
    outcome: "BAMFAM",
  });

  // 20:00 New York on 31 August.
  const nightBefore = movedSlot({
    id: "inv-night-before",
    name: "Pluto",
    email: "pluto@example.com",
    scheduled_at: "2026-09-01T00:00:00Z",
  });
  // 20:00 New York on 1 September — the call that was held.
  const onTheDay = booking({
    id: "inv-on-the-day",
    name: "Pluto",
    email: "pluto@example.com",
    scheduled_at: "2026-09-02T00:00:00Z",
  });

  it("stays on 31 August, so September's funnel does not count it", () => {
    const link = linkBookings([nightBefore, onTheDay], [recorded], {
      timeZone: BUSINESS,
      now: NOW,
    });
    const byId = new Map(link.bookings.map((b) => [b.id, b]));
    expect(bookingDate(byId.get("inv-night-before")!)).toBe("2026-08-31");
    expect(bookingDate(byId.get("inv-on-the-day")!)).toBe("2026-09-01");
    expect(byId.get("inv-on-the-day")?.call_id).toBe("call-pluto");
    expect(byId.get("inv-night-before")?.call_id).toBeNull();
  });

  /**
   * Read as UTC, an August booking is counted inside September. The call still
   * joins, because the email path tolerates a day either side — so nothing on
   * the page looks wrong, and one month's funnel quietly holds the previous
   * month's booking. At a month boundary that is systematic, not bad luck.
   */
  it("read as UTC, files an August booking inside September", () => {
    const link = linkBookings([nightBefore, onTheDay], [recorded], { now: NOW });
    const byId = new Map(link.bookings.map((b) => [b.id, b]));
    expect(bookingDate(byId.get("inv-night-before")!)).toBe("2026-09-01");
    expect(bookingDate(byId.get("inv-on-the-day")!)).toBe("2026-09-02");
  });
});
