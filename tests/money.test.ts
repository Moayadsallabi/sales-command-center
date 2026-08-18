/**
 * The money rules, and the close-rate rule that sits beside them.
 *
 * Every case here is a mistake this dashboard has actually made and been
 * corrected on. They are written as the rule, not as the incident, so they
 * still read sensibly once nobody remembers the incident.
 */
import { describe, it, expect } from "vitest";
import {
  carriesCash,
  carriesClose,
  carriesRevenue,
  closeRateOf,
  collectedToDate,
  heldCalls,
  isWin,
  missingFxRate,
  reportingRevenue,
  reportingCollected,
} from "../src/lib/money";
import { REFUND_CARRIES_CLOSE, MIN_DEPOSIT } from "../src/lib/sales-rules";
import { call } from "./helpers";

describe("a refunded deal", () => {
  const refund = call({ outcome: "REFUND", price_closed: 2000, cash_collected: 2000 });

  it("is not revenue", () => {
    expect(carriesRevenue(refund)).toBe(false);
  });

  it("is not cash", () => {
    expect(carriesCash(refund)).toBe(false);
  });

  it("is not counted as a loss in the close rate", () => {
    // The ruling is that it comes out of BOTH sides. Counting it in the
    // denominator alone would put a failed call on the closer's record, which
    // is a different claim from the one a refund actually makes.
    expect(REFUND_CARRIES_CLOSE).toBe(false);
    expect(carriesClose(refund)).toBe(false);
  });

  it("does not drag a perfect close rate below 100%", () => {
    const calls = [call({ outcome: "Customer" }), refund];
    expect(closeRateOf(calls)).toBe(100);
  });
});

describe("a no-show", () => {
  const noShow = call({ outcome: "No show" });

  it("is not in the close-rate denominator", () => {
    expect(carriesClose(noShow)).toBe(false);
  });

  it("cannot dilute a close rate", () => {
    expect(closeRateOf([call({ outcome: "Customer" }), noShow])).toBe(100);
  });
});

describe("close rate", () => {
  it("is null when nothing was held, rather than zero", () => {
    // Zero reads as "everyone said no". Null reads as "no calls" — which is
    // what an empty week actually is.
    expect(closeRateOf([])).toBeNull();
    expect(closeRateOf([call({ outcome: "No show" })])).toBeNull();
  });

  it("counts a win over the calls that were held", () => {
    const calls = [
      call({ outcome: "Customer" }),
      call({ outcome: "No deal" }),
      call({ outcome: "BAMFAM" }),
      call({ outcome: "No show" }),
    ];
    expect(heldCalls(calls)).toHaveLength(3);
    expect(closeRateOf(calls)).toBeCloseTo(33.33, 1);
  });

  it("treats only a Customer as a win", () => {
    expect(isWin(call({ outcome: "Customer" }))).toBe(true);
    for (const outcome of ["BAMFAM", "No deal", "No offer made", "REFUND", "No show"]) {
      expect(isWin(call({ outcome }))).toBe(false);
    }
  });
});

describe("revenue", () => {
  it("never books a paid deal at zero just because no price was recorded", () => {
    // A follow-up that later paid often carries no price at all. Reading
    // price_closed alone booked it at nothing.
    const paid = call({ outcome: "Customer", price_closed: null, paid_total: 1500 });
    expect(reportingRevenue(paid)).toBe(1500);
  });

  it("keeps the recorded price when only part of it has been paid", () => {
    const partly = call({ outcome: "Customer", price_closed: 4000, paid_total: 1000 });
    expect(reportingRevenue(partly)).toBe(4000);
  });
});

describe("currency", () => {
  it("converts a foreign deal at the rate captured on the row", () => {
    const euro = call({ outcome: "Customer", price_closed: 3000, currency: "EUR", fx_rate: 1.2 });
    expect(reportingRevenue(euro)).toBeCloseTo(3600, 5);
  });

  it("names a foreign row with no rate instead of counting it 1:1", () => {
    const unrated = call({ price_closed: 3000, currency: "EUR", fx_rate: null });
    expect(missingFxRate(unrated)).toBe(true);
  });

  it("does not flag a row already in the reporting currency", () => {
    expect(missingFxRate(call({ currency: "USD", fx_rate: null }))).toBe(false);
    expect(missingFxRate(call({ currency: null, fx_rate: null }))).toBe(false);
  });
});

describe("cash", () => {
  it("falls back to what was taken on the call until the hand-filled total lands", () => {
    expect(collectedToDate(call({ collected_on_call: 500, cash_collected: null }))).toBe(500);
    expect(collectedToDate(call({ collected_on_call: 500, cash_collected: 1800 }))).toBe(1800);
  });

  it("counts a deposit taken on a call that did not close", () => {
    // Cash and revenue have different denominators on purpose: money moves on
    // calls that are not wins. Counting cash on customers only hid these.
    const deposit = call({ outcome: "BAMFAM", collected_on_call: 500 });
    expect(carriesCash(deposit)).toBe(true);
    expect(reportingCollected(deposit)).toBe(500);
    expect(carriesRevenue(deposit)).toBe(false);
  });
});

describe("the deposit floor", () => {
  it("is a flat amount, not a share of the deal", () => {
    // Under a percentage bar the same $500 deposit was a sale on a $2,000 deal
    // and not one on a $4,000 deal, which judges the closer by the size of the
    // offer rather than by what they banked.
    expect(MIN_DEPOSIT).toBe(100);
  });
});
