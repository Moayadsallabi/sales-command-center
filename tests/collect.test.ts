/**
 * The collect list, and the ways a chase list costs real money by being wrong.
 *
 * Both directions are expensive and opposite. Leave a paid-up customer on it
 * and somebody rings them for money they have already sent — the fault that put
 * Zay on the follow-up list for a month. Drop a genuine balance and a second
 * instalment is never collected, which is the whole reason this exists.
 *
 * EVERY FIXTURE IS BUILT SO THE TWO READINGS DIFFER. A deal where the tracker's
 * typed figure equals what the processor received passes whichever field the
 * code reads — the unfalsifiable shape that let a 120% close rate ship — so the
 * rows here disagree on purpose.
 */
import { describe, it, expect } from "vitest";
import {
  collectable,
  COLLECT_QUIET_DAYS,
  COLLECT_COLD_DAYS,
  COLLECT_FLOOR,
} from "../src/lib/collect";
import { MatchedPayment } from "../src/lib/reconcile";
import { CallRecord } from "../src/lib/types";
import { call } from "./helpers";

const TODAY = "2026-09-03";

const won = (over: Partial<CallRecord> = {}) =>
  call({ outcome: "Customer", price_closed: 4000, ...over });

const paidBy = (
  c: CallRecord,
  over: Partial<MatchedPayment> = {}
): MatchedPayment => ({
  call: c,
  paid: 2000,
  refunded: 0,
  payments: 1,
  history: [{ day: "2026-08-01", amount: 2000 }],
  last: "2026-08-01",
  certain: true,
  ...over,
});

describe("who owes money", () => {
  it("holds part-paid wins and nothing else", () => {
    const half = won({ name: "Half Paid", call_date: "2026-07-01" });
    const full = won({ name: "Paid Up", call_date: "2026-07-01" });
    const lost = call({ name: "No Deal", outcome: "No deal", price_discussed: 4000 });
    const result = collectable(
      [half, full, lost],
      [paidBy(half), paidBy(full, { paid: 4000 })],
      TODAY
    );

    expect(result.items.map((i) => i.call.name)).toEqual(["Half Paid"]);
    expect(result.items[0].owed).toBe(2000);
    expect(result.owed).toBe(2000);
  });

  it("reads the processor over the tracker, and says which it read", () => {
    // The row says the closer collected the lot; the processor has half. This
    // is the population the list is FOR — instalments land weeks later and
    // nobody goes back to the row — so the two figures must not be equal here
    // or the assertion cannot fail.
    const drifted = won({ name: "Row Says Paid", cash_collected: 4000 });
    const result = collectable([drifted], [paidBy(drifted, { paid: 1000 })], TODAY);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].paid).toBe(1000);
    expect(result.items[0].owed).toBe(3000);
    expect(result.items[0].evidence).toBe("email");
  });

  it("falls back to the tracker when no payment could be tied to the call", () => {
    const untied = won({ name: "Unmatched", prospect_email: "u@b.com", cash_collected: 1500 });
    const result = collectable([untied], [], TODAY);

    expect(result.items[0].paid).toBe(1500);
    expect(result.items[0].owed).toBe(2500);
    expect(result.items[0].evidence).toBe("unfound");
  });

  it("leaves rounding behind rather than putting it on a worklist", () => {
    const dust = won({ name: "Fee Short" });
    const result = collectable(
      [dust],
      [paidBy(dust, { paid: 4000 - (COLLECT_FLOOR - 1) })],
      TODAY
    );
    expect(result.items).toHaveLength(0);
  });

  it("counts a win with no price rather than showing or dropping it", () => {
    // Nothing can say what is outstanding without a price. Counted whether or
    // not money arrived — a payment against an untyped price says nothing
    // about what was agreed, so "they paid $500" is not evidence that $500 was
    // the deal. Both no-price rows are in the count and neither is on the list;
    // the priced row proves the count is of the gap and not of every win.
    const blank = won({ name: "No Price", price_closed: null });
    const blankPaid = won({ name: "No Price, Paid Something" , price_closed: null });
    const priced = won({ name: "Priced" });
    const result = collectable(
      [blank, blankPaid, priced],
      [paidBy(blankPaid, { paid: 500 }), paidBy(priced)],
      TODAY
    );

    expect(result.unpriced).toBe(2);
    expect(result.items.map((i) => i.call.name)).toEqual(["Priced"]);
  });
});

describe("how quiet each one has gone", () => {
  it("counts from the last payment, not from the call", () => {
    // The call was in May and the money arrived in August. Dating the silence
    // from the call would report this deal as four months quiet when somebody
    // paid five weeks ago — the reading that turns a live plan into a chase.
    const paying = won({ name: "Still Paying", call_date: "2026-05-01" });
    const result = collectable([paying], [paidBy(paying, { last: "2026-08-01" })], TODAY);

    expect(result.items[0].quiet).toBe(33);
    expect(result.items[0].clockFrom).toBe("payment");
    expect(result.items[0].lastPaid).toBe("2026-08-01");
  });

  it("counts from the call when no payment has ever arrived", () => {
    const never = won({ name: "Never Paid", call_date: "2026-08-04", cash_collected: null });
    const result = collectable([never], [], TODAY);

    expect(result.items[0].quiet).toBe(30);
    expect(result.items[0].clockFrom).toBe("call");
    expect(result.items[0].owed).toBe(4000);
  });

  it("distinguishes money with no date from no money at all", () => {
    // The tracker's Cash Collected is a running total with no date beside it,
    // so an unmatched row can hold $3,375 and know nothing about when it came.
    // Both rows below fall back to the call for their clock, and the panel has
    // to be able to tell them apart: one has been paid and one has not, and
    // saying "nothing yet" over the first contradicts its own figure.
    const undated = won({ name: "Paid, No Date", call_date: "2026-08-04", cash_collected: 3000 });
    const never = won({ name: "Nothing At All", call_date: "2026-08-04" });
    const result = collectable([undated, never], [], TODAY);

    const paidRow = result.items.find((i) => i.call.name === "Paid, No Date")!;
    const emptyRow = result.items.find((i) => i.call.name === "Nothing At All")!;
    expect(paidRow.clockFrom).toBe("call");
    expect(paidRow.lastPaid).toBeNull();
    expect(paidRow.paid).toBe(3000);
    expect(emptyRow.paid).toBe(0);
  });

  it("puts the longest silence at the top, and the bigger balance inside a tie", () => {
    const old = won({ name: "Oldest", call_date: "2026-06-01" });
    const recentSmall = won({ name: "Recent Small", price_closed: 2000 });
    const recentBig = won({ name: "Recent Big", price_closed: 9000 });
    const result = collectable(
      [recentSmall, old, recentBig],
      [
        paidBy(old, { last: "2026-06-02" }),
        paidBy(recentSmall, { last: "2026-09-01", paid: 500 }),
        paidBy(recentBig, { last: "2026-09-01", paid: 500 }),
      ],
      TODAY
    );

    expect(result.items.map((i) => i.call.name)).toEqual([
      "Oldest",
      "Recent Big",
      "Recent Small",
    ]);
  });

  it("counts the two marks", () => {
    const cold = won({ name: "Cold" });
    const quiet = won({ name: "Quiet" });
    const fresh = won({ name: "Fresh" });
    const daysAgo = (n: number) =>
      new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 864e5).toISOString().slice(0, 10);

    const result = collectable(
      [cold, quiet, fresh],
      [
        paidBy(cold, { last: daysAgo(COLLECT_COLD_DAYS) }),
        paidBy(quiet, { last: daysAgo(COLLECT_QUIET_DAYS) }),
        paidBy(fresh, { last: daysAgo(COLLECT_QUIET_DAYS - 1) }),
      ],
      TODAY
    );

    // All three are owed and all three are listed — the marks colour the list,
    // they never shorten it. A balance nobody has chased for a week is still a
    // balance, and hiding it is how it becomes one nobody chased for a year.
    expect(result.items).toHaveLength(3);
    expect(result.cold).toBe(1);
    expect(result.quiet).toBe(2);
  });
});

describe("money that came and went", () => {
  it("takes a refunded deal off the list rather than calling it a debt", () => {
    /* THE LIVE CASE, 2026-09-04. Thalyco paid $2,000 in full on a $2,000 deal
       and was refunded $1,666.67. The processor's total is net of a refund, so
       he arrives having "paid $333" — and the list had him on it, with a
       closer's name beside it, as $1,667 to go and collect from a customer who
       had already paid in full and been given most of it back.

       The refunded row and the plain part-paid row below hold the SAME
       shortfall on purpose: with only a refunded row in the fixture, code that
       ignored refunds entirely would still produce a one-row list and pass. */
    const refundedRow = won({ name: "Refunded", price_closed: 2000 });
    const genuine = won({ name: "Genuinely Part Paid", price_closed: 2000 });
    const result = collectable(
      [refundedRow, genuine],
      [
        paidBy(refundedRow, { paid: 333.33, refunded: 1666.67 }),
        paidBy(genuine, { paid: 333.33 }),
      ],
      TODAY
    );

    expect(result.items.map((i) => i.call.name)).toEqual(["Genuinely Part Paid"]);
    expect(result.refunded.count).toBe(1);
    expect(result.refunded.value).toBe(1667);
    // And the headline follows the list it heads.
    expect(result.owed).toBeCloseTo(1666.67, 2);
  });
});

describe("what each row is resting on", () => {
  it("grades the tie to the money, and only an address needs no caveat", () => {
    const byEmail = won({ name: "By Address", prospect_email: "a@b.com" });
    const byName = won({ name: "By Name", prospect_email: "c@d.com" });
    const notFound = won({ name: "Address, No Payment", prospect_email: "e@f.com", cash_collected: 1000 });
    const noEmail = won({ name: "No Address", prospect_email: null, cash_collected: 1000 });
    const result = collectable(
      [byEmail, byName, notFound, noEmail],
      [paidBy(byEmail, { certain: true }), paidBy(byName, { certain: false })],
      TODAY
    );

    const grade = (name: string) =>
      result.items.find((i) => i.call.name === name)!.evidence;
    expect(grade("By Address")).toBe("email");
    expect(grade("By Name")).toBe("name");
    expect(grade("Address, No Payment")).toBe("unfound");
    expect(grade("No Address")).toBe("no_email");
    expect(result.uncheckable).toBe(1);
  });

  it("keeps what the closer typed beside what arrived, when they differ", () => {
    /* Live: a row typed $1,060 collected while $1,560 had arrived. The screen
       is right and the row is stale, and a caller who cannot see both is
       arguing with the dashboard. Only stated where a payment was actually
       found — with nothing to compare against, the tracker's figure IS the
       figure and repeating it as a disagreement would be noise. */
    const stale = won({ name: "Stale Row", price_closed: 2000, cash_collected: 1060 });
    const agrees = won({ name: "Row Agrees", price_closed: 2000, cash_collected: 500 });
    const unmatched = won({ name: "Nothing To Compare", price_closed: 2000, cash_collected: 500 });
    const result = collectable(
      [stale, agrees, unmatched],
      [paidBy(stale, { paid: 1560 }), paidBy(agrees, { paid: 500 })],
      TODAY
    );

    const row = (name: string) => result.items.find((i) => i.call.name === name)!;
    expect(row("Stale Row").trackerSays).toBe(1060);
    expect(row("Stale Row").owed).toBe(440);
    expect(row("Row Agrees").trackerSays).toBeNull();
    expect(row("Nothing To Compare").trackerSays).toBeNull();
  });
});

describe("what nothing could check", () => {
  it("counts a row with no email whose figure is the tracker's own", () => {
    // The shape a duplicated row takes: Brey's tracker holds one Danny with an
    // address and another, three days later, without one — both marked
    // Customer at $4,000, and the second is almost certainly the same sale
    // typed twice. Unsaid, the panel turns it into $4,000 to go and chase.
    //
    // The three rows differ on purpose: an unmatched row WITH an address is
    // checkable and must not be counted, or the figure would just be "every
    // unmatched row" wearing a more specific label.
    const noEmail = won({ name: "Danny Johnson", prospect_email: null, cash_collected: null });
    const withEmail = won({ name: "Has Address", prospect_email: "a@b.com", cash_collected: 1000 });
    const matchedRow = won({ name: "Matched", prospect_email: "m@b.com" });
    const result = collectable(
      [noEmail, withEmail, matchedRow],
      [paidBy(matchedRow, { paid: 1000 })],
      TODAY
    );

    expect(result.items).toHaveLength(3);
    expect(result.uncheckable).toBe(1);
  });
});

describe("currency", () => {
  it("converts the deal before subtracting the money, never after", () => {
    // A €4,000 deal with $2,200 received. Subtracting 4000 from 2200 without
    // the rate reports $1,800 owed on a balance that is really about $2,120 —
    // and the row would sit on the list understating itself for ever.
    const euro = won({ name: "Euro Deal", currency: "EUR", fx_rate: 1.08 });
    const result = collectable([euro], [paidBy(euro, { paid: 2200 })], TODAY);

    expect(result.items[0].price).toBeCloseTo(4320, 5);
    expect(result.items[0].owed).toBeCloseTo(2120, 5);
  });
});

describe("the join between the matcher and this list", () => {
  it("survives a row settle() replaced", () => {
    /* reconcile runs BEFORE settle, and settle returns a new record for every
       row it promotes from "no deal" to a win. So the call object inside a
       match is not the object that reaches this list. Keying the two together
       by identity loses the processor's figure for precisely the rows a payment
       was found for — they would silently fall back to the tracker's typed cash
       and report the wrong balance, which is the failure this list exists to
       prevent. The fixture rebuilds the record the way settle does. */
    const original = call({
      id: "same-row",
      name: "Promoted",
      outcome: "BAMFAM",
      price_closed: 4000,
      cash_collected: 4000,
    });
    const settled = { ...original, outcome: "Customer", recorded_outcome: "BAMFAM" };
    const result = collectable([settled], [paidBy(original, { paid: 500 })], TODAY);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].evidence).toBe("email");
    expect(result.items[0].owed).toBe(3500);
  });
});

describe("the headline says how much of itself to trust", () => {
  it("counts every row resting on less than an address match", () => {
    /* The cost of this list being wrong is a customer being told they owe
       money they have paid, and a caveat in small grey type under an amount is
       read after somebody has decided to ring. So the count travels with the
       headline. Live on 2026-09-04 it was 9 of 23. */
    const clean = won({ name: "Clean", prospect_email: "a@b.com" });
    const byName = won({ name: "Name", prospect_email: "c@d.com" });
    const unfound = won({ name: "Unfound", prospect_email: "e@f.com", cash_collected: 500 });
    const noEmail = won({ name: "Blank", prospect_email: null, cash_collected: 500 });
    const result = collectable(
      [clean, byName, unfound, noEmail],
      [paidBy(clean, { certain: true }), paidBy(byName, { certain: false })],
      TODAY
    );

    expect(result.items).toHaveLength(4);
    expect(result.needsChecking).toBe(3);
  });
});

describe("when no processor was read at all", () => {
  it("does not claim a search that never happened", () => {
    /* A client with no Whop key, one reporting in a currency Whop does not
       settle in, or any load where the crawl failed. An empty match list alone
       cannot tell "nobody has paid" from "nobody looked", and the demo build —
       which reads no processor by design — put "no payment found" against all
       seventeen of its rows, which is a claim about money rather than about
       configuration.

       Asserted against the SAME fixture read both ways, so the two cannot be
       satisfied by one answer. */
    const withEmail = won({ name: "Has Address", prospect_email: "a@b.com", cash_collected: 1000 });
    const noEmail = won({ name: "No Address", prospect_email: null, cash_collected: 1000 });

    const unread = collectable([withEmail, noEmail], [], TODAY, false);
    expect(unread.processorRead).toBe(false);
    expect(unread.items.map((i) => i.evidence)).toEqual(["unread", "unread"]);
    // The caveat is about the whole panel, so it is not also counted per row.
    expect(unread.needsChecking).toBe(0);
    expect(unread.uncheckable).toBe(0);

    const read = collectable([withEmail, noEmail], [], TODAY);
    expect(read.items.map((i) => i.evidence)).toEqual(["unfound", "no_email"]);
    expect(read.needsChecking).toBe(2);
    expect(read.uncheckable).toBe(1);
  });
});
