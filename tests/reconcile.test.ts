/**
 * Tying a payment to a call when the two systems share no identifier.
 *
 * The refusals matter as much as the matches here: sending someone to correct
 * the wrong prospect's row is worse than reporting a gap, so several of these
 * assert that nothing happened.
 */
import { describe, it, expect } from "vitest";
import { reconcile } from "../src/lib/reconcile";
import { settle, wasSettledByPayment } from "../src/lib/settle";
import { call, buyer } from "./helpers";

describe("a no-show who paid later", () => {
  const noShow = call({ name: "Denis Moore", outcome: "No show", prospect_email: "denis@x.com" });
  const paid = buyer({ email: "denis@x.com", name: "Denis Moore", paid: 2000 });

  it("is not promoted to a won call", () => {
    const result = reconcile([noShow], [paid]);
    expect(result.missedCloses).toHaveLength(0);
    expect(settle([noShow], result)[0].outcome).toBe("No show");
  });

  it("still shows the money, as a buyer with no call behind them", () => {
    // The point of dropping them from matching is that the payment surfaces in
    // the coverage panel rather than disappearing from the page entirely.
    const result = reconcile([noShow], [paid]);
    expect(result.untracked).toBe(1);
    expect(result.untrackedWorth).toBe(2000);
  });

  it("does not hold the payment hostage from a call they did attend", () => {
    const later = call({ name: "Denis Moore", outcome: "BAMFAM", prospect_email: "denis@x.com" });
    const result = reconcile([noShow, later], [paid]);
    expect(result.missedCloses).toHaveLength(1);
    expect(result.missedCloses[0].call.id).toBe(later.id);
  });
});

describe("the deposit floor", () => {
  const open = (email: string) =>
    call({ name: "Ignacio Reyes", outcome: "BAMFAM", prospect_email: email });

  it("leaves a token payment as the closer recorded it", () => {
    const result = reconcile([open("i@x.com")], [buyer({ email: "i@x.com", paid: 25 })]);
    expect(result.missedCloses).toHaveLength(0);
  });

  it("counts a real deposit as a close even though the balance is unpaid", () => {
    const result = reconcile([open("i@x.com")], [buyer({ email: "i@x.com", paid: 100 })]);
    expect(result.missedCloses).toHaveLength(1);
  });

  it("draws the line at the floor exactly", () => {
    const under = reconcile([open("i@x.com")], [buyer({ email: "i@x.com", paid: 99 })]);
    expect(under.missedCloses).toHaveLength(0);
  });
});

describe("matching refuses rather than guesses", () => {
  it("drops a row whose two best candidates tie", () => {
    // Two different people fit equally well and nothing here can tell them
    // apart. A gap beats sending someone to the wrong row.
    const ambiguous = call({ name: "Daniel", outcome: "BAMFAM" });
    const result = reconcile(
      [ambiguous],
      [
        buyer({ email: "a@x.com", name: "Daniel Smith" }),
        buyer({ email: "b@x.com", name: "Daniel Jones" }),
      ]
    );
    expect(result.missedCloses).toHaveLength(0);
    expect(result.untracked).toBe(2);
  });

  it("does not let a short name match inside an unrelated word", () => {
    // "Tee" must not find "steel".
    const result = reconcile(
      [call({ name: "Tee", outcome: "BAMFAM" })],
      [buyer({ email: "s@x.com", name: "Steel Robinson" })]
    );
    expect(result.missedCloses).toHaveLength(0);
  });

  it("lets one buyer claim only one call", () => {
    const first = call({ name: "Jeremy Daniel", outcome: "BAMFAM", call_date: "2026-08-01" });
    const second = call({ name: "Jeremy Daniel", outcome: "BAMFAM", call_date: "2026-08-09" });
    const result = reconcile([first, second], [buyer({ email: "j@x.com", name: "Jeremy Daniel" })]);
    expect(result.missedCloses).toHaveLength(1);
  });

  it("prefers an email match over any name match", () => {
    const exact = call({ name: "Someone Else", outcome: "BAMFAM", prospect_email: "real@x.com" });
    const result = reconcile(
      [exact],
      [
        buyer({ email: "real@x.com", name: "Unrelated Name", paid: 3000 }),
        buyer({ email: "other@x.com", name: "Someone Else", paid: 500 }),
      ]
    );
    expect(result.missedCloses).toHaveLength(1);
    expect(result.missedCloses[0].paid).toBe(3000);
    expect(result.missedCloses[0].certain).toBe(true);
  });
});

describe("a refunded deal", () => {
  it("is left alone rather than re-promoted by whatever payment remains", () => {
    // A REFUND on the tracker is a statement about the deal and beats the
    // arithmetic of what is left of their payments.
    const refunded = call({ name: "V Crawford", outcome: "REFUND", prospect_email: "v@x.com" });
    const result = reconcile([refunded], [buyer({ email: "v@x.com", paid: 2000 })]);
    expect(result.missedCloses).toHaveLength(0);
  });
});

describe("settling", () => {
  it("keeps what the closer typed alongside what it is being counted as", () => {
    // A number that moves on its own is one a closer will dispute, and they
    // are right to.
    const open = call({ name: "Marlon Reid", outcome: "BAMFAM", prospect_email: "m@x.com" });
    const result = reconcile([open], [buyer({ email: "m@x.com", paid: 2000 })]);
    const settled = settle([open], result)[0];

    expect(settled.outcome).toBe("Customer");
    expect(settled.recorded_outcome).toBe("BAMFAM");
    expect(settled.paid_total).toBe(2000);
    expect(wasSettledByPayment(settled)).toBe(true);
  });

  it("returns the original list untouched when there is nothing to settle", () => {
    const calls = [call({ outcome: "No deal" })];
    expect(settle(calls, reconcile(calls, []))).toBe(calls);
  });
});
