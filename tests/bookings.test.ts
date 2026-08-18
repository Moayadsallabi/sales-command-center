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
