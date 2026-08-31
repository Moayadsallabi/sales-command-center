/**
 * ONE ROW PER RECORDING.
 *
 * Three of Brey's August 2026 calls were written to the tracker twice — 26, 27
 * and 30 August — each pair created inside the same minute by two deliveries of
 * one Fathom webhook. The workflow checks Notion for the recording's id before
 * writing, and cannot win the race: the check and the write are two calls with
 * nothing holding the gap.
 *
 * Nothing on the page could see it. A second copy of a real call looks exactly
 * like a real call, so it inflated calls recorded, calls taken, the close-rate
 * denominator, cash and the average score at once, and every one of those
 * figures stayed internally consistent while being wrong.
 */
import { describe, it, expect } from "vitest";
import { dedupeByRecording } from "../src/lib/notion";
import { call } from "./helpers";

describe("a recording written to the tracker twice", () => {
  it("is counted once", () => {
    const { kept, duplicates } = dedupeByRecording([
      call({ name: "Jaden Pierce", recording_id: 177111109, outcome: "BAMFAM" }),
      call({ name: "Jaden Pierce", recording_id: 177111109, outcome: "BAMFAM" }),
    ]);
    expect(kept).toHaveLength(1);
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].dropped).toHaveLength(1);
  });

  it("keeps the more complete copy, not whichever arrived first", () => {
    // A redelivery can land after somebody has typed an outcome onto the first
    // row, so the pairs are not always identical. Dropping the filled-in one
    // would lose a closer's work and change the close rate with it.
    const bare = call({ name: "Unknown", recording_id: 42, outcome: null, quality_score: null });
    const full = call({
      name: "Unknown",
      recording_id: 42,
      outcome: "Customer",
      quality_score: 7.4,
      price_closed: 4000,
    });
    const { kept } = dedupeByRecording([bare, full]);
    expect(kept).toHaveLength(1);
    expect(kept[0].outcome).toBe("Customer");
  });

  it("does not depend on the order Notion returned them in", () => {
    const a = call({ name: "A", recording_id: 7, outcome: "Customer" });
    const b = call({ name: "B", recording_id: 7, outcome: "Customer" });
    const forward = dedupeByRecording([a, b]).kept[0].id;
    const backward = dedupeByRecording([b, a]).kept[0].id;
    expect(forward).toBe(backward);
  });
});

describe("what is not a duplicate", () => {
  it("leaves two genuinely different calls alone", () => {
    const { kept, duplicates } = dedupeByRecording([
      call({ recording_id: 1 }),
      call({ recording_id: 2 }),
    ]);
    expect(kept).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });

  it("never collapses rows that simply have no recording id", () => {
    // `null` is the absence of the key, not a value two rows can share. One
    // August row carries no recording id at all — a call rescued by hand — and
    // collapsing those together would delete real calls, which is a far worse
    // failure than the one this guard exists to fix.
    const { kept, duplicates } = dedupeByRecording([
      call({ name: "Antonio Cepeda", recording_id: null }),
      call({ name: "Someone Else", recording_id: null }),
    ]);
    expect(kept).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });
});
