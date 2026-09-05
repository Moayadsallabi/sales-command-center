/**
 * Laying what was booked over what was recorded.
 *
 * The rule this module must never break: a booking with no recording is NOT a
 * no-show. It might be one, or it might be a call that happened with nobody
 * recording it, and those two want opposite fixes — chase the prospect, or fix
 * the recorder.
 */
import { describe, it, expect } from "vitest";
import { linkBookings, funnelStats } from "../src/lib/bookings";
import { BookingRecord } from "../src/lib/calendly";
import { call } from "./helpers";

let seq = 0;
function booking(over: Partial<BookingRecord> = {}): BookingRecord {
  seq += 1;
  return {
    id: `inv-${seq}`,
    event_id: `evt-${seq}`,
    event_type: "Profitability Game Plan Call",
    name: `Prospect ${seq}`,
    email: `p${seq}@example.com`,
    booked_at: "2026-08-05T10:00:00Z",
    scheduled_at: "2026-08-10T15:00:00Z",
    lead_time_days: 5,
    status: "active",
    canceled_by_side: null,
    canceled_by: null,
    cancel_reason: null,
    canceled_at: null,
    ...over,
  } as BookingRecord;
}

/** Well after every fixture date, so nothing counts as upcoming. */
const NOW = new Date("2026-08-20T00:00:00Z");

describe("a booking with no recording", () => {
  it("is reported as unknown, not as a no-show", () => {
    const link = linkBookings([booking()], [], NOW);
    expect(link.bookings[0].state).toBe("unrecorded");
  });

  it("is left out of the show rate rather than resolved either way", () => {
    const stats = funnelStats(linkBookings([booking()], [], NOW).bookings, []);
    expect(stats.unrecorded).toBe(1);
    expect(stats.kept).toBe(0);
    expect(stats.noShow).toBe(0);
  });
});

describe("matching a booking to its recording", () => {
  it("joins on the prospect's address", () => {
    const c = call({ prospect_email: "p1@example.com", call_date: "2026-08-10" });
    const b = booking({ email: "p1@example.com", scheduled_at: "2026-08-10T15:00:00Z" });
    const link = linkBookings([b], [c], NOW);
    expect(link.bookings[0].state).toBe("kept");
    expect(link.bookings[0].match_method).toBe("email");
    expect(link.bookings[0].call_id).toBe(c.id);
  });

  it("reads a no-show off the recording's own outcome", () => {
    const c = call({
      prospect_email: "p1@example.com",
      call_date: "2026-08-10",
      outcome: "No show",
    });
    const b = booking({ email: "p1@example.com", scheduled_at: "2026-08-10T15:00:00Z" });
    expect(linkBookings([b], [c], NOW).bookings[0].state).toBe("no_show");
  });

  it("ties each recording to at most one booking", () => {
    // Someone who books, no-shows, rebooks and then buys has two bookings and
    // one recording. The recording belongs to the nearer booking.
    const c = call({ prospect_email: "p@example.com", call_date: "2026-08-14" });
    const early = booking({ email: "p@example.com", scheduled_at: "2026-08-01T15:00:00Z" });
    const late = booking({ email: "p@example.com", scheduled_at: "2026-08-14T15:00:00Z" });
    const link = linkBookings([early, late], [c], NOW);
    const matched = link.bookings.filter((b) => b.call_id !== null);
    expect(matched).toHaveLength(1);
    expect(matched[0].id).toBe(late.id);
  });
});

describe("a cancelled booking", () => {
  it("is never counted as a show or a no-show", () => {
    const b = booking({ status: "canceled", canceled_at: "2026-08-09T10:00:00Z" });
    const stats = funnelStats(linkBookings([b], [], NOW).bookings, []);
    expect(stats.canceled).toBe(1);
    expect(stats.kept + stats.noShow + stats.unrecorded).toBe(0);
  });
});

describe("a booking still ahead of us", () => {
  it("counts as neither held nor missed", () => {
    const soon = booking({ scheduled_at: "2026-09-01T15:00:00Z" });
    const stats = funnelStats(linkBookings([soon], [], NOW).bookings, []);
    expect(stats.upcoming).toBe(1);
    expect(stats.booked).toBe(0);
  });
});

/**
 * "N cancelled" was three unrelated events added together, and the sum was
 * read as leads lost. Brey's team cancels a booking when they judge a prospect
 * unqualified, so most of that figure was their own filtering working.
 */
describe("what a cancellation actually was", () => {
  const cancelled = (over: Partial<BookingRecord> = {}) =>
    booking({
      status: "canceled",
      canceled_at: "2026-08-09T15:00:00Z",
      cancel_notice_hours: 24,
      canceled_by_side: "host",
      ...over,
    });

  it("keeps a moved slot out of what was booked, because its replacement is already counted", () => {
    // One person, one request for a call, three rows: Calendly leaves the
    // original behind as a cancelled row every time somebody shifts their slot.
    const moved = [
      cancelled({ rescheduled: true, scheduled_at: "2026-08-08T15:00:00Z" }),
      cancelled({ rescheduled: true, scheduled_at: "2026-08-09T15:00:00Z" }),
      booking({ scheduled_at: "2026-08-10T15:00:00Z" }),
    ];
    const stats = funnelStats(linkBookings(moved, [], NOW).bookings, []);
    expect(stats.rescheduledAway).toBe(2);
    expect(stats.booked).toBe(1);
    // Asserted as a strict inequality rather than against 3: with the count
    // hard-coded, reading `canceled` instead of the reschedule flag would pass.
    expect(stats.booked).toBeLessThan(stats.canceled + stats.unrecorded);
    // A reschedule is never somebody being screened out, however Calendly
    // labelled who pressed the button.
    expect(stats.screened).toBe(0);
  });

  it("counts the team calling it off apart from the prospect calling it off", () => {
    const stats = funnelStats(
      linkBookings(
        [
          cancelled({ canceled_by_side: "host" }),
          cancelled({ canceled_by_side: "host" }),
          cancelled({ canceled_by_side: "invitee" }),
        ],
        [],
        NOW
      ).bookings,
      []
    );
    expect(stats.screened).toBe(2);
    expect(stats.pulledOut).toBe(1);
  });

  it("never treats a cancellation after the start time as screening", () => {
    // Nobody disqualifies a prospect once the call was already due. Teams clear
    // a no-show off the calendar by cancelling it afterwards, so counting this
    // as screening would hide the no-show AND flatter the held rate.
    const stats = funnelStats(
      linkBookings([cancelled({ cancel_notice_hours: -0.4 })], [], NOW).bookings,
      []
    );
    expect(stats.canceledAfterStart).toBe(1);
    expect(stats.screened).toBe(0);
    expect(stats.pulledOut).toBe(0);
    // It stays in what was booked: a call was due and nobody was on it.
    expect(stats.booked).toBe(1);
  });

  it("does not charge the held rate for leads the team screened out", () => {
    // Moayad's ruling, 2026-09-05. One call held, one prospect screened out.
    // Counting the screened one as a booking that went nowhere reads as a 50%
    // hold rate on a day when everything the team wanted to happen happened.
    const held = booking({ scheduled_at: "2026-08-10T15:00:00Z" });
    const call = {
      id: "call-held",
      name: "Prospect held",
      prospect_email: held.email,
      closer: "Tpan A",
      call_date: "2026-08-10",
      outcome: "Customer",
    } as unknown as Parameters<typeof funnelStats>[1][number];
    const stats = funnelStats(
      linkBookings([held, cancelled({ canceled_by_side: "host" })], [call], NOW).bookings,
      [call]
    );
    expect(stats.kept).toBe(1);
    expect(stats.screened).toBe(1);
    expect(stats.heldRate).toBe(100);
  });
});

/**
 * THE FOUR MEANINGS HAVE TO ADD UP TO THE TOTAL THEY CAME FROM.
 *
 * `canceledAfterStart` counts every late cancellation including moved slots, so
 * it overlaps the three meanings and cannot close the partition. Read off the
 * live account before this existed, the buckets on offer summed to 21 against
 * 19 cancelled rows, and to 130 against 120 — figures that do not subtract,
 * which is the fault the notes under the tiles were rewritten for.
 */
describe("the cancellation split", () => {
  it("partitions every cancelled booking exactly once", () => {
    const rows = [
      // moved, and moved LATE, so it is in canceledAfterStart too
      booking({ status: "canceled", rescheduled: true, cancel_notice_hours: -0.2,
        canceled_at: "2026-08-10T16:00:00Z", canceled_by_side: "host" }),
      booking({ status: "canceled", rescheduled: true, cancel_notice_hours: 40,
        canceled_at: "2026-08-08T15:00:00Z", canceled_by_side: "host" }),
      booking({ status: "canceled", cancel_notice_hours: 20,
        canceled_at: "2026-08-09T19:00:00Z", canceled_by_side: "host" }),
      booking({ status: "canceled", cancel_notice_hours: 4,
        canceled_at: "2026-08-10T11:00:00Z", canceled_by_side: "invitee" }),
      booking({ status: "canceled", cancel_notice_hours: -0.4,
        canceled_at: "2026-08-10T15:24:00Z", canceled_by_side: "host" }),
    ];
    const s = funnelStats(linkBookings(rows, [], NOW).bookings, []);
    expect(s.canceled).toBe(5);
    expect(s.rescheduledAway + s.screened + s.pulledOut + s.clearedAfterStart).toBe(s.canceled);
    // And the wider field still counts both late ones, which is why it cannot
    // be the fourth bucket.
    expect(s.canceledAfterStart).toBe(2);
    expect(s.clearedAfterStart).toBe(1);
  });
});
