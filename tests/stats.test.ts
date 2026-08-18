/**
 * The panels, and specifically the denominators they measure over.
 *
 * Most of these exist because two panels on the same screen once answered the
 * same question differently.
 */
import { describe, it, expect } from "vitest";
import { closerLeaderboard, dimensionImpact, biggestCosts } from "../src/lib/stats";
import { call, scoresAt } from "./helpers";

describe("the closer leaderboard", () => {
  it("does not count a no-show against the closer's close rate", () => {
    const rows = closerLeaderboard([
      call({ closer: "Tpan", outcome: "Customer" }),
      call({ closer: "Tpan", outcome: "No show" }),
    ]);
    expect(rows[0].taken).toBe(1);
    expect(rows[0].closeRate).toBe(100);
  });

  it("does not count a refund against it either", () => {
    const rows = closerLeaderboard([
      call({ closer: "Tpan", outcome: "Customer" }),
      call({ closer: "Tpan", outcome: "REFUND", price_closed: 2000 }),
    ]);
    expect(rows[0].closeRate).toBe(100);
    expect(rows[0].revenue).toBe(0);
    expect(rows[0].cashCollected).toBe(0);
  });

  it("credits a deposit taken on a call that did not close", () => {
    // Counting cash on customers only hid deposits taken while booking a
    // follow-up, and made this table disagree with the call list below it.
    const rows = closerLeaderboard([
      call({ closer: "Tpan", outcome: "BAMFAM", collected_on_call: 500 }),
    ]);
    expect(rows[0].cashCollected).toBe(500);
    expect(rows[0].revenue).toBe(0);
  });

  it("will not name a weakest habit off a single call", () => {
    const one = closerLeaderboard([
      call({ closer: "Tpan", outcome: "No deal", scores: scoresAt(4) }),
    ]);
    expect(one[0].weakest).toBeNull();

    const three = closerLeaderboard(
      Array.from({ length: 3 }, () =>
        call({ closer: "Tpan", outcome: "No deal", scores: scoresAt(4) })
      )
    );
    expect(three[0].weakest).not.toBeNull();
  });

  it("still lists a closer with no scored calls at all", () => {
    const rows = closerLeaderboard([call({ closer: "Chris", outcome: "No deal" })]);
    expect(rows[0].avgScore).toBeNull();
    expect(rows[0].scoredCalls).toBe(0);
  });
});

describe("dimension impact", () => {
  /** Enough calls to clear the panel's own minimums. */
  const bucket = (n: number, score: number, outcome: string) =>
    Array.from({ length: n }, () => call({ outcome, scores: scoresAt(score) }));

  it("measures close rate over held calls only", () => {
    // This panel used to run over every scored call, no-shows included, while
    // three panels beside it excluded them. A scored no-show must not pull a
    // bucket's close rate down.
    const clean = [...bucket(10, 9, "Customer"), ...bucket(10, 3, "No deal")];
    const polluted = [...clean, ...bucket(6, 9, "No show")];

    const a = dimensionImpact(clean);
    const b = dimensionImpact(polluted);
    expect(a.impacts[0].goodCloseRate).toBe(100);
    expect(b.impacts[0].goodCloseRate).toBe(100);
    expect(b.impacts[0].goodCalls).toBe(a.impacts[0].goodCalls);
  });

  it("says how far short it is rather than reporting on too little", () => {
    const result = dimensionImpact(bucket(4, 8, "Customer"));
    expect(result.ready).toBe(false);
    expect(result.callsShort).toBeGreaterThan(0);
  });

  it("refuses to call a gap conclusive when one call would erase it", () => {
    const result = dimensionImpact([
      ...bucket(10, 9, "Customer"),
      ...bucket(5, 3, "Customer"),
    ]);
    const impact = result.impacts[0];
    if (impact) expect(impact.conclusive).toBe(impact.gap >= impact.swing);
  });
});

describe("what is costing you", () => {
  it("ignores no-shows when working out where calls go wrong", () => {
    const costs = biggestCosts([
      ...Array.from({ length: 5 }, () => call({ outcome: "No deal", scores: scoresAt(4) })),
      ...Array.from({ length: 5 }, () => call({ outcome: "No show", scores: scoresAt(1) })),
    ]);
    // The 1s belong to calls that never happened; they must not drag the
    // average down and invent a weakness nobody has.
    expect(costs[0].average).toBe(4);
  });
});
