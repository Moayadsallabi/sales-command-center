/**
 * The month grid, and which day a booking lands on.
 *
 * WHY THIS FILE EXISTS. Every other date on this dashboard is read and printed
 * as UTC on purpose, and for a `call_date` — a calendar day carrying no time —
 * that is right. A booking is the other kind of value: an instant, which only
 * becomes a day once you say whose day you mean.
 *
 * On the live Calendly account there are bookings at 00:30 and 01:30 UTC. On
 * the client's own business day — `America/New_York`, settled for this client
 * on 2026-09-06 and used for the ad spend and the call dates too — those are
 * calls at half eight and half nine the PREVIOUS EVENING. Drawn as UTC they
 * land one cell to the right of where everyone involved remembers them, in the
 * small hours, and the grid says the team took two calls at one in the morning.
 *
 * That is the case the first block below holds the code to, and it is
 * deliberately written so that reverting to a UTC slice fails it. Every date
 * here is fixed; nothing reads the clock.
 */
import { describe, it, expect } from "vitest";
import {
  CALENDAR_STATES,
  dayInZone,
  groupByDay,
  monthBounds,
  monthCoverage,
  monthGrid,
  monthOf,
  shiftMonth,
  stateCounts,
  timeInZone,
  usableZone,
} from "../src/lib/calendar";
import { LinkedBooking } from "../src/lib/bookings";

let seq = 0;
function booking(over: Partial<LinkedBooking> = {}): LinkedBooking {
  seq += 1;
  return {
    id: `inv-${seq}`,
    event_id: `evt-${seq}`,
    event_type: "Profitability Game Plan Call",
    name: `Prospect ${seq}`,
    email: `p${seq}@example.com`,
    booked_at: "2026-08-20T10:00:00Z",
    scheduled_at: "2026-08-26T00:30:00Z",
    lead_time_days: 5,
    status: "active",
    canceled_by_side: null,
    canceled_by: null,
    cancel_reason: null,
    canceled_at: null,
    cancel_notice_hours: null,
    marked_no_show: false,
    rescheduled: false,
    host: null,
    host_email: null,
    tracking: { source: null, medium: null, campaign: null, content: null, term: null },
    answers: [],
    state: "kept",
    call_id: null,
    match_method: null,
    ...over,
  } as LinkedBooking;
}

/** The client's business day. Not the Calendly login's — see below. */
const BUSINESS = "America/New_York";

describe("what day an evening call falls on", () => {
  // 26 August 2026, 00:30 UTC. New York is on EDT (UTC-4) in August, so this
  // is half eight on the EVENING OF THE 25th for the team taking it.
  const evening = "2026-08-26T00:30:00Z";

  it("puts a late-evening booking on the evening it happened, not the next morning", () => {
    expect(dayInZone(evening, BUSINESS)).toBe("2026-08-25");
    // The failing behaviour this exists to prevent, stated so the difference
    // is on the page rather than implied: a UTC slice gives the 26th.
    expect(evening.slice(0, 10)).toBe("2026-08-26");
  });

  it("prints it as an evening time, not as half past midnight", () => {
    expect(timeInZone(evening, BUSINESS)).toBe("20:30");
  });

  it("groups it onto the evening's cell", () => {
    const { days } = groupByDay([booking({ scheduled_at: evening })], BUSINESS);
    expect([...days.keys()]).toEqual(["2026-08-25"]);
  });

  it("still agrees with UTC for a booking in the middle of a working day", () => {
    const midday = "2026-08-26T15:00:00Z";
    expect(dayInZone(midday, BUSINESS)).toBe("2026-08-26");
    expect(timeInZone(midday, BUSINESS)).toBe("11:00");
  });

  it("follows the business zone across a daylight-saving change", () => {
    // Same clock time either side of the US change on 1 November 2026: EDT is
    // UTC-4, EST is UTC-5, so the same UTC instant is an hour apart locally.
    // This is why the zone is stored as `America/New_York` and never as the
    // literal "EST" — a fixed offset would be an hour out for half the year.
    expect(timeInZone("2026-10-30T15:00:00Z", BUSINESS)).toBe("11:00");
    expect(timeInZone("2026-11-06T15:00:00Z", BUSINESS)).toBe("10:00");
  });

  it("renders midnight as 00:00, never as 24:00", () => {
    expect(timeInZone("2026-08-26T04:00:00Z", BUSINESS)).toBe("00:00");
  });

  /**
   * THE NEAR MISS, which is the one that actually shipped.
   *
   * The first version of this panel read the zone off the CALENDLY ACCOUNT —
   * whoever created the login, America/Chicago here, against a business that
   * runs on America/New_York. One hour out, and nothing looks wrong: the times
   * are still working hours. Only the calls at either end of the day land on
   * the wrong square, which is a fault you find by being told, not by looking.
   */
  it("is an hour out on the Calendly login's zone, and can cross a day", () => {
    expect(timeInZone("2026-08-26T15:00:00Z", "America/Chicago")).toBe("10:00");
    expect(timeInZone("2026-08-26T15:00:00Z", BUSINESS)).toBe("11:00");

    // 9pm Eastern on the 25th. Chicago calls it the 25th too — agreeing for
    // the wrong reason — but an hour later the two zones disagree on the day.
    const ninePmEastern = "2026-08-26T01:00:00Z";
    expect(dayInZone(ninePmEastern, BUSINESS)).toBe("2026-08-25");
    const midnightEastern = "2026-08-26T04:00:00Z";
    expect(dayInZone(midnightEastern, BUSINESS)).toBe("2026-08-26");
    expect(dayInZone(midnightEastern, "America/Chicago")).toBe("2026-08-25");
  });
});

describe("a zone the runtime does not know", () => {
  it("falls back to UTC rather than throwing halfway down the page", () => {
    expect(usableZone("Mars/Olympus_Mons")).toBe("UTC");
    expect(usableZone(null)).toBe("UTC");
    expect(usableZone("Europe/London")).toBe("Europe/London");
  });
});

describe("a booking with an unreadable start time", () => {
  it("is counted as dropped rather than piled onto some arbitrary day", () => {
    const { days, dropped } = groupByDay(
      [booking({ scheduled_at: "not a date" }), booking()],
      "UTC"
    );
    expect(dropped).toBe(1);
    expect([...days.values()].flat()).toHaveLength(1);
  });
});

describe("the days in a cell", () => {
  it("are in the order the calls were due", () => {
    const { days } = groupByDay(
      [
        booking({ scheduled_at: "2026-08-26T16:00:00Z", name: "Second" }),
        booking({ scheduled_at: "2026-08-26T09:00:00Z", name: "First" }),
      ],
      "UTC"
    );
    expect(days.get("2026-08-26")?.map((e) => e.booking.name)).toEqual([
      "First",
      "Second",
    ]);
  });
});

describe("monthGrid", () => {
  it("starts on the Monday on or before the 1st", () => {
    // 1 August 2026 is a Saturday, so the grid opens on Monday 27 July.
    expect(monthGrid("2026-08")[0]).toBe("2026-07-27");
  });

  it("ends on the Sunday on or after the last day", () => {
    // 31 August 2026 is a Monday, so the grid runs on to Sunday 6 September.
    const grid = monthGrid("2026-08");
    expect(grid[grid.length - 1]).toBe("2026-09-06");
  });

  it("is always whole weeks", () => {
    for (const month of ["2026-01", "2026-02", "2026-08", "2026-11", "2024-02"]) {
      expect(monthGrid(month).length % 7).toBe(0);
    }
  });

  it("has no gaps and no repeats", () => {
    const grid = monthGrid("2026-08");
    expect(new Set(grid).size).toBe(grid.length);
    for (let i = 1; i < grid.length; i++) {
      const gap =
        Date.parse(`${grid[i]}T00:00:00Z`) - Date.parse(`${grid[i - 1]}T00:00:00Z`);
      expect(gap).toBe(864e5);
    }
  });

  it("covers a month that starts on a Monday without a blank leading week", () => {
    // 1 June 2026 is a Monday.
    expect(monthGrid("2026-06")[0]).toBe("2026-06-01");
  });

  it("holds every day of a leap February", () => {
    expect(monthGrid("2024-02")).toContain("2024-02-29");
  });
});

describe("month arithmetic", () => {
  it("steps over a year boundary in both directions", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("gives the right last day for short and leap months", () => {
    expect(monthBounds("2026-02").last).toBe("2026-02-28");
    expect(monthBounds("2024-02").last).toBe("2024-02-29");
    expect(monthBounds("2026-04").last).toBe("2026-04-30");
  });

  it("reads the month off a day", () => {
    expect(monthOf("2026-08-26")).toBe("2026-08");
  });
});

describe("how much of a month was read", () => {
  /**
   * The rule this exists for: an unread month and an empty month must never
   * render the same. Calendly is asked for a fixed window, and a grid of blank
   * cells for weeks nobody ever asked about reads as a quiet quarter.
   */
  it("calls a month entirely before the window unread", () => {
    expect(monthCoverage("2026-03", "2026-06-09T12:00:00Z", "UTC")).toEqual({
      kind: "unread",
    });
  });

  it("calls the month the window opens in partial, and says from when", () => {
    expect(monthCoverage("2026-06", "2026-06-09T12:00:00Z", "UTC")).toEqual({
      kind: "partial",
      from: "2026-06-09",
    });
  });

  it("calls a month after the window opens covered", () => {
    expect(monthCoverage("2026-08", "2026-06-09T12:00:00Z", "UTC")).toEqual({
      kind: "covered",
    });
  });

  it("treats a window opening on the 1st as covering the whole month", () => {
    expect(monthCoverage("2026-06", "2026-06-01T12:00:00Z", "UTC")).toEqual({
      kind: "covered",
    });
  });

  it("says covered when there is no window to test against", () => {
    expect(monthCoverage("2026-06", null, "UTC")).toEqual({ kind: "covered" });
  });

  /**
   * The boundary is read in the GRID'S zone, not in UTC.
   *
   * The window opens ninety days before whenever the process last started, so
   * an evening restart puts `windowStart` in the small hours UTC and on the
   * previous day in an American zone. Sliced as UTC, the notice names the 1st
   * and calls the month covered, while the grid's 1st is a day the calendar
   * never read — the panel then draws an unread day as an empty one, which is
   * the single thing it exists to refuse.
   */
  it("names the day a reader can find on the grid, not the UTC one", () => {
    // 02:00 UTC on 1 June is 22:00 on 31 May in New York.
    const opensLateOn31May = "2026-06-01T02:00:00Z";
    expect(monthCoverage("2026-06", opensLateOn31May, "UTC")).toEqual({
      kind: "covered",
    });
    expect(monthCoverage("2026-06", opensLateOn31May, BUSINESS)).toEqual({
      kind: "covered",
    });
    // And the month before, where the two answers actually differ: UTC says
    // May was never read; the business day says it was read from its last
    // evening.
    expect(monthCoverage("2026-05", opensLateOn31May, "UTC")).toEqual({
      kind: "unread",
    });
    expect(monthCoverage("2026-05", opensLateOn31May, BUSINESS)).toEqual({
      kind: "partial",
      from: "2026-05-31",
    });
  });
});

describe("the legend", () => {
  it("names every state a booking can be in, so none can render unlabelled", () => {
    const legended = CALENDAR_STATES.map((s) => s.state).sort();
    const possible = Object.keys(stateCounts([])).sort();
    expect(legended).toEqual(possible);
  });

  it("never labels an unmatched booking a no-show", () => {
    const unrecorded = CALENDAR_STATES.find((s) => s.state === "unrecorded");
    expect(unrecorded?.label).toBe("Not recorded");
    expect(unrecorded?.label.toLowerCase()).not.toContain("no-show");
  });

  it("counts each state, and reports the empty ones as zero rather than missing", () => {
    const counts = stateCounts([
      booking({ state: "kept" }),
      booking({ state: "kept" }),
      booking({ state: "canceled" }),
    ]);
    expect(counts).toEqual({
      kept: 2,
      canceled: 1,
      upcoming: 0,
      no_show: 0,
      unrecorded: 0,
    });
  });
});
