/**
 * What a period's cash is made of.
 *
 * Every case here is written so that it would FAIL if the code read the split
 * the other plausible way. That is deliberate and it is the point of the file:
 * on a fixture where every payment is a new deal paid in the month it closed,
 * all four readings agree and the suite is green whichever one is implemented
 * — the same unfalsifiable shape as the 120% close rate and the coverage line
 * that read 100% for ever [CLAUDE.md, 2026-08-25]. So the fixtures below
 * deliberately hold an older deal still paying, a deposit on a call that never
 * closed, money the tracker cannot explain, and a buyer whose lifetime total
 * is larger than anything they paid inside the window.
 */
import { describe, it, expect } from "vitest";
import { cashSplit } from "../src/lib/cash-split";
import { MatchedPayment } from "../src/lib/reconcile";
import { CallRecord } from "../src/lib/types";
import { PaymentDay } from "../src/lib/whop";
import { settleMatched } from "../src/lib/settle";
import { call } from "./helpers";

/** August 2026, the window every case below is read through. */
const AUGUST = { from: "2026-08-01", to: "2026-08-31" };

const won = (over: Partial<CallRecord> = {}) =>
  call({ outcome: "Customer", price_closed: 4000, ...over });

const paid = (c: CallRecord, history: PaymentDay[]): MatchedPayment => ({
  call: c,
  paid: history.reduce((sum, p) => sum + p.amount, 0),
  refunded: 0,
  payments: history.length,
  history,
  last: history.length > 0 ? history[history.length - 1].day : null,
  certain: true,
});

/**
 * One month with all four kinds of money in it, and no two of them equal.
 *
 * A closed-in-August deal paying $3,000; a June deal still paying $1,000; a
 * deposit of $500 on a call that never closed; and $250 the processor banked
 * that no call explains. Distinct amounts, so a bucket cannot be right by
 * coincidence.
 */
const MIXED: MatchedPayment[] = [
  paid(won({ call_date: "2026-08-12" }), [{ day: "2026-08-12", amount: 3000 }]),
  paid(won({ call_date: "2026-06-03" }), [{ day: "2026-08-20", amount: 1000 }]),
  paid(call({ outcome: "BAMFAM", call_date: "2026-08-22" }), [
    { day: "2026-08-22", amount: 500 },
  ]),
];
const MIXED_TOTAL = 4750;

describe("the four parts of a month's cash", () => {
  it("puts each payment in the bucket the call behind it says", () => {
    const split = cashSplit(MIXED, MIXED_TOTAL, AUGUST);
    expect(split).not.toBeNull();
    expect(split!.newCash).toBe(3000);
    expect(split!.remainder).toBe(1000);
    expect(split!.deposits).toBe(500);
    expect(split!.noCall).toBe(250);
  });

  it("adds up to the figure on the tile", () => {
    // The identity the breakdown exists to keep. It is asserted on a fixture
    // where all four are different and none is zero, because on a month made
    // only of new deals it holds no matter how the code reads the split.
    const split = cashSplit(MIXED, MIXED_TOTAL, AUGUST)!;
    expect(split.newCash + split.remainder + split.deposits + split.noCall).toBe(
      MIXED_TOTAL
    );
  });

  it("counts more as new than as remainder here, which is what makes the two readable apart", () => {
    // Written as an inequality rather than a second copy of the figures above:
    // a fixture whose new and remainder happened to be equal would pass the
    // first test whichever way round the code had them.
    const split = cashSplit(MIXED, MIXED_TOTAL, AUGUST)!;
    expect(split.newCash).toBeGreaterThan(split.remainder);
  });
});

describe("an older deal still paying", () => {
  const june = paid(won({ call_date: "2026-06-03" }), [
    { day: "2026-08-20", amount: 1000 },
  ]);

  it("is remainder, not this month's selling", () => {
    const split = cashSplit([june], 1000, AUGUST)!;
    expect(split.remainder).toBe(1000);
    expect(split.newCash).toBe(0);
  });

  it("becomes new selling when the window widens to contain its call", () => {
    // The same payment and the same deal, read through a window that starts
    // before the call: nothing is "an older deal" relative to a period that
    // contains it. Fails if `closedBefore` compares against anything but the
    // window's own start.
    const summer = cashSplit([june], 1000, { from: "2026-06-01", to: "2026-08-31" })!;
    expect(summer.newCash).toBe(1000);
    expect(summer.remainder).toBe(0);
  });

  it("has nowhere to be a remainder in an all-time view", () => {
    const allTime = cashSplit([june], 1000, { from: null, to: null })!;
    expect(allTime.remainder).toBe(0);
    expect(allTime.newCash).toBe(1000);
  });
});

describe("what the window does to a lifetime total", () => {
  it("counts only the payments that landed inside it", () => {
    // THE TRAP THIS WHOLE FILE EXISTS FOR. `paid` on a matched buyer is
    // everything they have ever paid — $9,000 here — and reading it instead of
    // the history would report a month three times its real size while every
    // other figure on the page stayed right.
    const spread = paid(won({ call_date: "2026-08-05" }), [
      { day: "2026-07-05", amount: 3000 },
      { day: "2026-08-05", amount: 3000 },
      { day: "2026-09-05", amount: 3000 },
    ]);
    expect(spread.paid).toBe(9000);

    const split = cashSplit([spread], 3000, AUGUST)!;
    expect(split.newCash).toBe(3000);
    expect(split.noCall).toBe(0);
  });
});

describe("money the tracker cannot explain", () => {
  it("is what is left of the processor's total, never a count of its own", () => {
    // No matched calls at all: every dollar the processor banked is money no
    // call accounts for. Derived by subtraction, so it cannot disagree with
    // the tile the way two independent counts would.
    const split = cashSplit([], 8200, AUGUST)!;
    expect(split.noCall).toBe(8200);
    expect(split.newCash + split.remainder + split.deposits).toBe(0);
  });
});

describe("a deposit on a call that never closed", () => {
  it("is counted, because the money moved", () => {
    // lib/money.ts counts this in the cash total. Leaving it out here would
    // leave it inside the total and outside every bucket, where it would come
    // back out as money with no call behind it — which is a different and
    // untrue statement about a call that is right there on the tracker.
    const deposit = paid(call({ outcome: "BAMFAM", call_date: "2026-08-22" }), [
      { day: "2026-08-22", amount: 500 },
    ]);
    const split = cashSplit([deposit], 500, AUGUST)!;
    expect(split.deposits).toBe(500);
    expect(split.noCall).toBe(0);
  });
});

describe("a buyer who paid before their call", () => {
  it("is this period's selling rather than an older deal", () => {
    // Paid on 28 August against a call on 2 September. It is not a remainder:
    // remainder means one thing only, that the deal had already closed when
    // the period opened. This shape is in CLAUDE.md as one no fixture had ever
    // contained.
    const early = paid(won({ call_date: "2026-09-02" }), [
      { day: "2026-08-28", amount: 2000 },
    ]);
    const split = cashSplit([early], 2000, AUGUST)!;
    expect(split.newCash).toBe(2000);
    expect(split.remainder).toBe(0);
  });
});

describe("when the parts come to more than the whole", () => {
  it("refuses to split rather than showing four figures that do not add up", () => {
    // The shape this guards: one buyer's payments claimed by two calls. Every
    // bucket would be plausible and the row would not sum to the tile.
    const doubled = [
      paid(won({ call_date: "2026-08-12" }), [{ day: "2026-08-12", amount: 3000 }]),
      paid(won({ call_date: "2026-08-13" }), [{ day: "2026-08-12", amount: 3000 }]),
    ];
    expect(cashSplit(doubled, 3000, AUGUST)).toBeNull();
  });

  it("tolerates a dollar of rounding, which is the only honest gap", () => {
    const one = paid(won({ call_date: "2026-08-12" }), [
      { day: "2026-08-12", amount: 3000.4 },
    ]);
    expect(cashSplit([one], 3000, AUGUST)).not.toBeNull();
  });
});

describe("a call promoted to a win by its payment", () => {
  it("is this period's selling, not a deposit", () => {
    // reconcile runs BEFORE settle, so a matched call still carries the
    // outcome typed on the day. Handing that straight to the split filed a
    // BAMFAM-that-paid as a deposit while the leaderboard beside it counted
    // the same call as a close — measured live on 2026-09-04. The caller runs
    // settleMatched first; this asserts the two readings differ, so that the
    // fixture cannot pass whichever one is wired up.
    const typedOnTheDay = call({ outcome: "BAMFAM", call_date: "2026-08-27" });
    const matched = [paid(typedOnTheDay, [{ day: "2026-08-27", amount: 5000 }])];

    const unsettled = cashSplit(matched, 5000, AUGUST)!;
    expect(unsettled.deposits).toBe(5000);
    expect(unsettled.newCash).toBe(0);

    // What the page actually hands it. A NEW object, as settle produces —
    // which is why settleMatched keys on the id and not on identity.
    const asCounted: CallRecord = {
      ...typedOnTheDay,
      outcome: "Customer",
      recorded_outcome: "BAMFAM",
    };
    const settled = cashSplit(
      settleMatched(matched, [asCounted]),
      5000,
      AUGUST
    )!;
    expect(settled.newCash).toBe(5000);
    expect(settled.deposits).toBe(0);
  });
});
