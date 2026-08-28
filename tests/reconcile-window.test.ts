/**
 * The Whop disagreement panel, narrowed to the dates on screen.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * The panel read the whole tracker whatever the date buttons said. With "This
 * month" selected it listed a call from 23 July, and nothing on the page said
 * that one panel out of ten had opted out of the filter — so the row read as a
 * bug in the dates rather than a deliberate exemption. [STATED — Moayad, chat
 * 2026-08-28: "u shouldnt be showing me ones from july, if i have this month
 * clicked it needs to respect time periods".]
 *
 * The trap this file is written against is the one CLAUDE.md names: a total
 * that quietly counts a different population from the rows above it. The two
 * halves here are placed by DIFFERENT dates on purpose — a disagreement by its
 * call date, an untracked buyer by their first payment, because an untracked
 * buyer has no call to be placed by. So the fixture below has rows that sit on
 * opposite sides of the window on each of those dates, and the assertions
 * check the boundary rather than a happy path where every date agrees.
 */
import { describe, it, expect } from "vitest";
import { reconcile, windowReconciliation } from "../src/lib/reconcile";
import { withinWindow } from "../src/lib/periods";
import { call, buyer } from "./helpers";

/** August, the month Moayad had selected when he found the July row. */
const AUGUST = { from: "2026-08-01", to: "2026-08-31" };
const inAugust = (date: string | null | undefined) => withinWindow(date, AUGUST);

/** Paid but never marked Customer — a row for the top half of the panel. */
const owed = (name: string, email: string, date: string) =>
  call({ name, prospect_email: email, call_date: date, outcome: "BAMFAM" });

describe("a disagreement is placed by its call date", () => {
  const july = owed("Luke July", "luke@x.com", "2026-07-23");
  const august = owed("Jaden August", "jaden@x.com", "2026-08-26");
  const full = reconcile(
    [july, august],
    [
      buyer({ email: "luke@x.com", paid: 1546, first: "2026-07-25" }),
      buyer({ email: "jaden@x.com", paid: 2000, first: "2026-08-27" }),
    ]
  );

  it("finds both of them before any window is applied", () => {
    // If this ever fails the rest of the file is testing an empty list, which
    // would pass whatever the windowing did.
    expect(full.missedCloses.map((d) => d.call.name).sort()).toEqual([
      "Jaden August",
      "Luke July",
    ]);
  });

  it("drops the July call when August is on screen", () => {
    const scoped = windowReconciliation(full, inAugust);
    expect(scoped.missedCloses.map((d) => d.call.name)).toEqual([
      "Jaden August",
    ]);
  });

  it("keeps strictly fewer rows than the unwindowed list, not a fixed count", () => {
    // Asserting `length === 1` would pass just as well if the filter were
    // dropping everything, or if the fixture happened to contain one row.
    const scoped = windowReconciliation(full, inAugust);
    expect(scoped.missedCloses.length).toBeLessThan(full.missedCloses.length);
    expect(scoped.missedCloses.length).toBeGreaterThan(0);
  });

  it("moves the headline worth down with the rows it dropped", () => {
    const scoped = windowReconciliation(full, inAugust);
    expect(scoped.worth).toBeLessThan(full.worth);
    expect(scoped.worth).toBe(2000);
  });

  it("hands back everything when the window is every call on record", () => {
    const scoped = windowReconciliation(full, () => true);
    expect(scoped.missedCloses).toHaveLength(full.missedCloses.length);
    expect(scoped.worth).toBe(full.worth);
  });
});

describe("an untracked buyer is placed by their first payment", () => {
  // Nobody on the tracker, so every buyer lands in the untracked list.
  const full = reconcile(
    [],
    [
      buyer({ email: "old@x.com", paid: 5000, first: "2026-06-02" }),
      buyer({ email: "new@x.com", paid: 900, first: "2026-08-14" }),
    ]
  );

  it("counts only the buyers whose first payment landed in the window", () => {
    const scoped = windowReconciliation(full, inAugust);
    expect(full.untracked).toBe(2);
    expect(scoped.untracked).toBe(1);
    expect(scoped.untrackedBuyers[0].email).toBe("new@x.com");
  });

  it("keeps the money a lifetime total, which is what the panel says it is", () => {
    // The buyer carries what they have paid in ALL, not what they paid inside
    // these dates — Whop hands over one figure per buyer. Windowing the list
    // therefore cannot window the money, and the sentence on screen reads
    // "first paid in this period ... they have paid X between them to date".
    // If this ever becomes a per-window figure, that sentence has to change
    // with it.
    const scoped = windowReconciliation(full, inAugust);
    expect(scoped.untrackedWorth).toBe(900);
    expect(scoped.untrackedWorth).toBeLessThan(full.untrackedWorth);
  });

  it("does not drop a buyer whose first payment date is unknown into the window", () => {
    // `first` is nullable. A missing date must not silently count as inside
    // whatever range happens to be selected.
    const undated = reconcile([], [buyer({ email: "n@x.com", first: null })]);
    expect(undated.untracked).toBe(1);
    expect(windowReconciliation(undated, inAugust).untracked).toBe(0);
  });

  it("still counts that undated buyer when no dates are selected at all", () => {
    // THE PANEL AND THE CASH TILE MUST AGREE ABOUT THIS ONE BUYER. The tile's
    // own count already keeps undated buyers on an unbounded range — its
    // comment records that writing it the other way round made the two report
    // different totals for the same set. Both now defer to withinWindow, which
    // is true for a null date only when both ends are open, and this pins that.
    const undated = reconcile([], [buyer({ email: "n@x.com", first: null })]);
    const everything = { from: null, to: null };
    const scoped = windowReconciliation(undated, (d) =>
      withinWindow(d, everything)
    );
    expect(scoped.untracked).toBe(1);
  });
});
