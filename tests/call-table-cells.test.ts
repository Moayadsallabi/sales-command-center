/**
 * THE TABLE HAS TO ADD UP TO THE TILE ABOVE IT.
 *
 * Both faults here were found by reading Brey's live September on 2026-09-10,
 * and both are the same shape: a cell that answers a slightly different
 * question from the total it sits under, with nothing on screen saying so.
 *
 *   The Revenue column printed `price_closed`. Revenue is
 *   `max(price_closed, paid_total)`, so a call settled by a payment and
 *   carrying no price rendered "—" while contributing to the tile. The column
 *   summed to $30,000 under a tile reading $30,500.
 *
 *   A row typed Customer with nothing banked kept its gold Customer badge,
 *   with an empty Cash cell and no explanation — while the follow-up panel
 *   three sections below listed the same call as open. Two panels, one screen,
 *   opposite answers about ABandZz's $8,000.
 */
import { describe, it, expect } from "vitest";
import {
  carriesRevenue,
  demotedByMoneyRule,
  REPORTING_CURRENCY,
  reportingRevenue,
  revenueCell,
} from "../src/lib/money";
import { call } from "./helpers";

describe("the revenue cell", () => {
  it("prints the agreed price in the deal's own currency", () => {
    const row = call({ outcome: "Customer", price_closed: 4000, collected_on_call: 4000 });
    expect(revenueCell(row)).toEqual({ amount: 4000, currency: null });
  });

  it("prints the payment when the deal carries no price", () => {
    // Alex (Bairon Leiva), 3 September: recorded BAMFAM, promoted by a $500
    // payment, no Price Closed on the row. This is the $500 the column lost.
    const row = call({
      name: "Alex (Bairon Leiva)",
      outcome: "Customer",
      recorded_outcome: "BAMFAM",
      price_closed: null,
      paid_total: 500,
      collected_on_call: 0,
    });
    expect(revenueCell(row)).toEqual({ amount: 500, currency: REPORTING_CURRENCY });
  });

  it("prints nothing on a call that did not win", () => {
    // A price the prospect refused is not revenue, whatever column it sits in.
    const row = call({ outcome: "No deal", price_closed: 4000 });
    expect(revenueCell(row)).toBeNull();
  });

  it("prints nothing on a win worth nothing, rather than a zero", () => {
    const row = call({ outcome: "Customer", price_closed: null, collected_on_call: 500 });
    expect(revenueCell(row)).toBeNull();
  });

  /**
   * THE INVARIANT, over a set of rows shaped like the live ones.
   *
   * Every dollar the tile counts has to be visible in the column beneath it.
   * Asserted as a sum rather than row by row, because that is the reading a
   * person actually does when the two disagree.
   */
  it("sums to the same total as the tile", () => {
    const rows = [
      call({ outcome: "Customer", price_closed: 4000, collected_on_call: 4000 }),
      call({ outcome: "Customer", price_closed: 5000, collected_on_call: 3250 }),
      call({ outcome: "Customer", price_closed: null, paid_total: 500, collected_on_call: 0 }),
      call({ outcome: "Customer", price_closed: 8000, collected_on_call: 0 }),
      call({ outcome: "BAMFAM", price_discussed: 2000, collected_on_call: 0 }),
      call({ outcome: "No show" }),
    ];

    const tile = rows.filter(carriesRevenue).reduce((sum, r) => sum + reportingRevenue(r), 0);
    const column = rows.reduce((sum, r) => sum + (revenueCell(r)?.amount ?? 0), 0);

    expect(column).toBe(tile);
    // Stated so the numbers are on the page: $4,000 + $5,000 + the $500 that
    // used to render as a dash. The $8,000 is ABandZz, out of both by the
    // money rule.
    expect(tile).toBe(9500);
  });
});

describe("a call the money rule demoted", () => {
  const abandzz = call({
    name: "ABandZz",
    outcome: "Customer",
    price_closed: 8000,
    collected_on_call: 0,
  });

  it("is marked on the row, because the badge still says Customer", () => {
    expect(demotedByMoneyRule(abandzz)).toBe(true);
  });

  it("does not mark a win, or a call nobody claimed was one", () => {
    expect(
      demotedByMoneyRule(call({ outcome: "Customer", collected_on_call: 4000 }))
    ).toBe(false);
    expect(demotedByMoneyRule(call({ outcome: "BAMFAM" }))).toBe(false);
    expect(demotedByMoneyRule(call({ outcome: "No show" }))).toBe(false);
  });

  it("is marked whether the money is missing from the row or from the processor", () => {
    // The row typed a figure and the processor confirms nothing, or the row
    // typed nothing at all — same verdict, because `isWin` reads the greater of
    // the two and neither reaches the floor.
    expect(
      demotedByMoneyRule(
        call({ outcome: "Customer", collected_on_call: 50, paid_total: null })
      )
    ).toBe(true);
  });
});
