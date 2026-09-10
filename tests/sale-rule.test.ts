/**
 * A CLOSE NEEDS MONEY TO HAVE MOVED — and the rule has two readers.
 *
 * `sales-rules.json` settled this on 2026-09-06 and `src/lib/money.ts` obeyed it
 * the same day. `scripts/check-collect.mjs` did not, because nobody remembered
 * it was a second reader — and it is the one that runs on a schedule and prints
 * a list of customers to ring about money.
 *
 * Measured on Brey, 2026-09-10: the panel listed 24 people owing $47,648, the
 * check listed 28 owing $63,648, and the four in between were calls the rule had
 * already demoted to follow-ups. ABandZz's $8,000 was one of them — the exact
 * call the ruling was written about.
 *
 * A shared JSON settles what the numbers ARE. It cannot make two pieces of code
 * ask the same question, which is what `scripts/lib/sale-rule.mjs` is for. The
 * cases below are that rule's table, and the last block asserts that the app
 * reaches the same verdict through its own front door.
 */
import { describe, it, expect } from "vitest";
import { countsAsWin, moneyMoved } from "../scripts/lib/sale-rule.mjs";
import { isWin, carriesClose } from "../src/lib/money";
import { MIN_DEPOSIT, REFUND_OUTCOME, WINNING_OUTCOMES } from "../src/lib/sales-rules";
import { call } from "./helpers";

const RULES = {
  winning: WINNING_OUTCOMES,
  refund: REFUND_OUTCOME,
  minDeposit: MIN_DEPOSIT,
};

describe("the money behind a call", () => {
  it("is the greater of the two accounts of it, never the sum", () => {
    // The tracker's typed figure and the processor's total describe the same
    // deposit. Adding them books a $500 deposit as $1,000.
    expect(moneyMoved(500, 500)).toBe(500);
    expect(moneyMoved(500, 4000)).toBe(4000);
    expect(moneyMoved(4000, 500)).toBe(4000);
  });

  it("treats an unrecorded figure as nothing, not as unknown", () => {
    expect(moneyMoved(null, null)).toBe(0);
    expect(moneyMoved(undefined, 250)).toBe(250);
  });
});

describe("whether a call counts as a close", () => {
  it("needs a winning outcome AND money", () => {
    expect(countsAsWin("Customer", MIN_DEPOSIT, RULES)).toBe(true);
    expect(countsAsWin("Customer", MIN_DEPOSIT - 1, RULES)).toBe(false);
    expect(countsAsWin("BAMFAM", 5000, RULES)).toBe(false);
  });

  it("refuses a refund however much moved", () => {
    expect(countsAsWin(REFUND_OUTCOME, 10_000, RULES)).toBe(false);
  });

  it("is inclusive at the floor, so a deposit exactly on it is a sale", () => {
    // [sales-rules.json] "A payment proves a sale once it REACHES $100."
    expect(countsAsWin("Customer", 100, RULES)).toBe(true);
    expect(countsAsWin("Customer", 99.99, RULES)).toBe(false);
  });
});

/**
 * THE LIVE ROW THE RULING WAS WRITTEN ABOUT.
 *
 * ABandZz, 5 September, recorded as a customer at $8,000 against a $200 deposit
 * the prospect said he would send by Zelle after going to the bank. Nothing ever
 * arrived. It is a follow-up, and every total has to agree that it is.
 */
describe("a price agreed with nothing banked", () => {
  const abandzz = call({
    name: "ABandZz",
    outcome: "Customer",
    price_closed: 8000,
    collected_on_call: 0,
    cash_collected: null,
  });

  it("is not a close, however the closer wrote it up", () => {
    expect(isWin(abandzz)).toBe(false);
    expect(countsAsWin(abandzz.outcome, moneyMoved(0, null), RULES)).toBe(false);
  });

  it("still counts in the denominator, because the call did happen", () => {
    // Out of the wins, not out of the calls taken — otherwise the close rate
    // would improve every time a closer failed to collect.
    expect(carriesClose(abandzz)).toBe(true);
  });
});

/**
 * The app's front door and the scripts' front door, on one set of rows.
 *
 * They share an implementation now, so this cannot fail while that holds — the
 * point is that it starts failing the moment somebody gives either side its own
 * copy again, which is precisely what happened last time.
 */
describe("the two readers of the rule", () => {
  const cases = [
    { outcome: "Customer", tracked: 4000, matched: null },
    { outcome: "Customer", tracked: 0, matched: null },
    { outcome: "Customer", tracked: 50, matched: null },
    { outcome: "Customer", tracked: null, matched: 500 },
    { outcome: "BAMFAM", tracked: 0, matched: 500 },
    { outcome: "No deal", tracked: 0, matched: null },
    { outcome: REFUND_OUTCOME, tracked: 2000, matched: 2000 },
  ];

  it("agree on every shape a live row takes", () => {
    for (const c of cases) {
      const row = call({
        outcome: c.outcome,
        collected_on_call: c.tracked,
        cash_collected: null,
        paid_total: c.matched,
      });
      const viaScript = countsAsWin(
        c.outcome,
        moneyMoved(c.tracked, c.matched),
        RULES
      );
      expect({ ...c, win: isWin(row) }).toEqual({ ...c, win: viaScript });
    }
  });
});
