/**
 * THE SENTENCES UNDER THE TILES, WHICH ARE FIGURES TOO.
 *
 * Both faults here were in prose rather than in a metric, which is why nothing
 * caught them: the numbers each note quoted were computed correctly, and no two
 * of them could be reconciled by the person reading them. A sentence that
 * states a number is a number, and gets asserted like one.
 */
import { describe, it, expect } from "vitest";
import {
  recordedNoteFor,
  cashNoteFor,
  cashBreakdownFor,
} from "../src/lib/tile-notes";
import type { FunnelStats } from "../src/lib/bookings";

const funnel = (over: Partial<FunnelStats> = {}): FunnelStats =>
  ({
    booked: 0,
    canceled: 0,
    rescheduledAway: 0,
    screened: 0,
    pulledOut: 0,
    clearedAfterStart: 0,
    kept: 0,
    noShow: 0,
    unrecorded: 0,
    upcoming: 0,
    showRate: null,
    showRateRange: null,
    coverage: null,
    heldRate: null,
    lateCancels: 0,
    canceledAfterStart: 0,
    canceledByInvitee: 0,
    canceledByHost: 0,
    medianCancelNotice: null,
    callsWithoutBooking: 0,
    matchedByName: 0,
    matchedByFirstNameOnly: 0,
    ...over,
  }) as FunnelStats;

describe("the note under Recorded", () => {
  it("states counts the calendar owns and never a rate", () => {
    // LIVE, August 2026. It read "218 booked in this window, 14% produced a
    // recording" under a tile showing 76 recordings. 76 of 218 is 35%. The 14%
    // was `kept / booked` — bookings the MATCHER could tie to a recording, over
    // a denominator that included every cancellation — so it measured the join
    // and was read as the business.
    const note = recordedNoteFor(funnel({ booked: 218, canceled: 110, kept: 31, heldRate: 14.2 }));
    expect(note).not.toContain("%");
    expect(note).toContain("218 booked in this window");
  });

  it("separates bookings the team called off from ones the prospect called off", () => {
    // "N cancelled" added three unrelated events together and the sum read as
    // lost leads. Brey's team cancels a booking when they judge the prospect
    // unqualified, so most of that number was their own filtering working.
    const note = recordedNoteFor(
      funnel({ booked: 32, canceled: 19, rescheduledAway: 10, screened: 6, pulledOut: 1 })
    );
    expect(note).toBe("32 booked in this window, 6 you called off, 1 pulled out");
    // The 19 must not appear: ten of it was the same people moving their slot.
    expect(note).not.toContain("19");
  });

  it("leaves out whichever kind did not happen", () => {
    expect(recordedNoteFor(funnel({ booked: 12, screened: 3 }))).toBe(
      "12 booked in this window, 3 you called off"
    );
    expect(recordedNoteFor(funnel({ booked: 12, pulledOut: 2 }))).toBe(
      "12 booked in this window, 2 pulled out"
    );
    // A window where nothing was called off says so by staying silent, rather
    // than printing a nought that reads as a missing figure.
    expect(recordedNoteFor(funnel({ booked: 12 }))).toBe("12 booked in this window");
  });

  it("says nothing about bookings when the calendar is not connected", () => {
    expect(recordedNoteFor(null)).toBe("every call that reached the tracker");
    expect(recordedNoteFor(funnel({ booked: 0 }))).toBe("every call that reached the tracker");
  });
});

describe("the note under Cash Collected", () => {
  it("states a gap the reader can get to from the two figures printed", () => {
    // LIVE, August 2026: $88,848.66 banked against $52,247.38 logged.
    //
    // Every figure was rounded correctly on its own, and the tile read $88,849,
    // $52,247 and a gap of "$36,601" — because the gap was the rounded RAW
    // difference, 36,601.28. A reader subtracting the two figures in front of
    // them gets 36,602, and there was nothing on the page to reconcile the two.
    // The printed gap is now that subtraction.
    const { note } = cashNoteFor(
      {
        collected: 88848.66,
        trackerLogged: 52247.38,
        previousCollected: null,
        split: null,
        missedCount: 0,
        missedWorth: 0,
      },
      true
    );
    expect(note).toContain("closers logged $52,247");
    expect(note).toContain("$36,602 less than was banked");
    // The old, unreconcilable figure.
    expect(note).not.toContain("$36,601");
    // AND IT NO LONGER CLAIMS THE MONEY HAS NO CALL. That is a different
    // quantity, answered by the breakdown on the same tile — which read
    // $33,704 for the same live month, because this gap also contains matched
    // calls whose typed cash figure is low. Two numbers for one phrase, six
    // inches apart, is the fault this file exists to prevent.
    expect(note).not.toContain("has no call behind it");
  });

  it("words itself the other way when the tracker is ahead of the processor", () => {
    const { note } = cashNoteFor(
      {
        collected: 1000,
        trackerLogged: 4000,
        previousCollected: null,
        split: null,
        missedCount: 0,
        missedWorth: 0,
      },
      true
    );
    expect(note).toContain("$3,000 of that isn't in Whop");
  });

  it("stays quiet inside the tolerance, where a gap is fees rather than a mistake", () => {
    const { note, source } = cashNoteFor(
      {
        collected: 1020,
        trackerLogged: 1000,
        previousCollected: null,
        split: null,
        missedCount: 0,
        missedWorth: 0,
      },
      true
    );
    expect(source).toBe("whop");
    expect(note).toBe("matches what closers logged");
  });

  it("says the figure changed source when a filter narrows the view", () => {
    const { source, note } = cashNoteFor(null, true);
    expect(source).toBe("tracker");
    expect(note).toContain("cannot follow a filter");
  });
});

describe("the four figures under Cash Collected", () => {
  it("shows all four, so the row always adds up to the tile above it", () => {
    // Including a zero. A month with nothing owed from before is a fact worth
    // printing, and dropping the zero would leave three figures that no longer
    // sum to the total — which is the fault this whole file exists to prevent.
    const rows = cashBreakdownFor({
      newCash: 3000,
      remainder: 0,
      deposits: 500,
      noCall: 250,
    })!;
    expect(rows.map((r) => r.label)).toEqual([
      "new",
      "remainder",
      "deposits",
      "no call",
    ]);
    expect(rows.map((r) => r.value)).toEqual(["$3,000", "$0", "$500", "$250"]);
  });

  it("shows nothing at all when the split was refused or the view is filtered", () => {
    // A refusal and a real zero must never render identically. Four zeroes
    // would say "every payment this month is accounted for"; nothing says
    // "this cannot be answered for the view you are looking at".
    expect(cashBreakdownFor(null)).toBeUndefined();
    expect(cashBreakdownFor(undefined)).toBeUndefined();
  });
});
