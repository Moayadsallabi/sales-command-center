/**
 * The first read of a calendar must not hold up the page.
 *
 * Measured on the live account 2026-08-27: 71 seconds. Two deployments read
 * the same Calendly account, both restart on every deploy, and both re-read all
 * 533 events at once through one 500-a-minute allowance — so they throttle each
 * other and whoever opens the dashboard first pays for all of it.
 *
 * The rule that makes not-waiting safe, and the only thing worth asserting
 * here: an unread calendar must NOT come back looking like an empty one. Both
 * are zero bookings. One means "nobody booked", the other means "we have not
 * looked yet", and a dashboard that renders them identically states the first
 * while meaning the second.
 *
 * Its own file because calendly.ts keeps module-level state — the event list —
 * and vitest gives each file a fresh copy. Sharing one would mean the second
 * test in the file was never testing a cold read at all.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { queryBookings } from "../src/lib/calendly";

const CFG = { apiKey: "cal-token", eventTypes: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a calendar nobody has read yet", () => {
  it("comes back at once rather than waiting for the crawl", async () => {
    // A crawl that never finishes. If queryBookings waits for it, this test
    // times out — which is precisely the production failure, slowed down.
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const started = Date.now();
    const result = await queryBookings(new Date(), CFG);

    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.reading).toBe(true);
    expect(result.bookings).toEqual([]);
  });

  it("says it has not looked, rather than that there was nothing to find", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    const result = await queryBookings(new Date(), CFG);

    // THE ASSERTION THAT MATTERS. total and pending are both 0 here, exactly as
    // they would be for a calendar with no bookings in the window — so `reading`
    // is the only thing telling the two apart, and every caller keys off it.
    expect(result.total).toBe(0);
    expect(result.pending).toBe(0);
    expect(result.reading).toBe(true);
  });

  it("still refuses to run with no token, rather than reporting an empty calendar", async () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));

    // Not configured is a third state again, and it must stay an error: a
    // client who has never connected Calendly is not one we are mid-read on.
    await expect(queryBookings(new Date(), { apiKey: "", eventTypes: null })).rejects.toThrow();
  });
});
