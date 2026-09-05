/**
 * WHAT THE SENTENCES UNDER THE TILES SAY.
 *
 * These are not presentation. Each one states figures, and both of them stated
 * figures that could not be reconciled with the tile they sat under — for as
 * long as anyone had been reading the page:
 *
 *   Recorded  "218 booked in this window, 14% produced a recording", under a
 *             tile reading 76. 76 of 218 is 35%.
 *   Cash      "$88,849" and "$52,247" and a gap of "$36,601", which is not
 *             what those two figures give when you subtract them.
 *
 * They lived as IIFEs inside the component, so the only way to assert on either
 * was to render the whole dashboard, and nothing ever did. They live here, beside
 * `roundedGap` in stats.ts, because the rule they carry is about numbers rather
 * than about rendering: WHAT GETS PRINTED HAS TO BE REACHABLE FROM THE FIGURES
 * PRINTED BESIDE IT.
 */
import { FunnelStats } from "./bookings";
import { CashSplit } from "./cash-split";
import { formatReporting } from "./money";

/** Which system a tile's number came from. Mirrors the pill on the tile. */
export type NoteSource = "whop" | "calendly" | "tracker";

/**
 * Present only when Whop is connected and no filter narrows the view.
 * `collected` is what the processor banked in the window; `trackerLogged`
 * is what the closers wrote down for the same window.
 */
export interface CashBank {
  collected: number;
  trackerLogged: number;
  /** The processor's total for the previous window. Null without one. */
  previousCollected: number | null;
  /**
   * What the total is made of: new selling, older deals paying off, deposits,
   * and the part no call explains. Null when it could not be trusted — see
   * lib/cash-split.ts, which refuses rather than showing four figures that
   * do not add up to the one above them.
   */
  split: CashSplit | null;
  /** Buyers who first paid inside this window with no call anywhere. */
  missedCount: number;
  /** What those buyers have paid to date — lifetime, not window. */
  missedWorth: number;
}

/**
 * The sentence under the Recorded tile.
 *
 * Exported for the same reason as `cashNoteFor` below: the rule it enforces —
 * never divide a Calendly count by a tracker count — is only worth having if
 * something asserts it, and asserting it meant rendering the page.
 */
export function recordedNoteFor(funnel: FunnelStats | null): string {
  if (!funnel || funnel.booked <= 0) return "every call that reached the tracker";

  /* "N CANCELLED" WAS THREE DIFFERENT EVENTS ADDED UP, AND READ AS LOST LEADS.
     On Brey's September it said "42 booked, 19 cancelled". Ten of the nineteen
     were people MOVING their slot — Calendly leaves the original behind as a
     cancelled row, so three of them were counted twice and the same call was
     still to come. Six were bookings the team called off on purpose, having
     judged the prospect unqualified. One was the prospect pulling out.
     Only the last of those is a booking anybody lost.

     So the moved slots are gone from `booked` entirely and the other two are
     named separately, because "we said no" and "they said no" are opposite
     facts about the same calendar and one number cannot carry both. */
  const parts = [`${funnel.booked} booked in this window`];
  if (funnel.screened > 0) parts.push(`${funnel.screened} you called off`);
  if (funnel.pulledOut > 0) parts.push(`${funnel.pulledOut} pulled out`);
  return parts.join(", ");
}

/**
 * The Cash Collected tile's source and the sentence under it.
 *
 * MODULE-LEVEL AND EXPORTED SO A TEST CAN REACH IT. It was an IIFE inside the
 * component, which meant the only way to assert on the sentence was to render
 * the whole dashboard — so nothing ever did, and the tile printed three figures
 * that would not subtract for as long as anyone had been reading it.
 */
export function cashNoteFor(
bank: CashBank | null | undefined,
payments: boolean
): { source: NoteSource; note: string } {
  // WHICH SOURCE THIS NUMBER CAME FROM, ALWAYS SAID.
  //
  // With Whop connected and nothing filtered, this tile shows what the
  // processor banked. The moment any filter narrows the view the processor's
  // figure cannot follow it — Whop knows nothing about closers or outcomes —
  // so the tile falls back to what the closers logged. That is the right
  // fallback and the wrong silence: the number changed source, and for a
  // while it said so only in the case where it did not change.
  //
  // The dot in front of the note now carries this too, so the change of
  // source is visible before the sentence is read.
  // `!bank` rather than `=== null`: the prop is optional, so "no Whop figure
  // for this view" arrives as either null or undefined.
  if (!bank) {
    return {
      source: "tracker",
      note: payments
        ? "Whop's figure covers the whole business, so it cannot follow a filter"
        : "logged by closers after the call",
    };
  }
  // SUBTRACTED AFTER ROUNDING, SO THE THREE FIGURES ON SCREEN ADD UP.
  //
  // The tile printed $88,849 and the note printed $52,247 and "$36,601 has no
  // call behind it" — three correct roundings of $88,848.66 and $52,247.38,
  // and no reader can get from the first two to the third. Same fault the
  // leads panel had with "83%, 29% and 55 points", and `roundedGap` in
  // lib/stats.ts carries the reasoning: whether a gap MATTERS is judged on
  // the real numbers, but what gets PRINTED has to be reachable from the
  // figures printed beside it.
  const gap = Math.round(bank.collected) - Math.round(bank.trackerLogged);
  if (Math.abs(gap) < 50)
    return { source: "whop", note: "matches what closers logged" };
  /* "SO $X HAS NO CALL BEHIND IT" — REMOVED 2026-09-04, AND THIS IS WHY.
     The tile now carries a four-way breakdown, one part of which is money no
     call explains. On Brey's live August the two figures were $36,602 here and
     $33,704 there, both labelled the same thing, six inches apart — the exact
     fault this file was written to end.
     They are not the same quantity. This gap is the processor's total against
     what closers TYPED into Cash Collected, so it includes matched calls whose
     typed figure is simply low. The breakdown's `no call` is money no call row
     could be tied to at all. So the sentence states what it actually measures
     and makes no claim about attribution, which the breakdown answers properly
     three lines below it. */
  return {
    source: "whop",
    note:
      gap > 0
        ? `closers logged ${formatReporting(
            bank.trackerLogged
          )} on the call rows, ${formatReporting(gap)} less than was banked`
        : `closers logged ${formatReporting(
            bank.trackerLogged
          )}, ${formatReporting(-gap)} of that isn't in Whop`,
  };
}

/**
 * The four figures under the Cash Collected tile.
 *
 * Formatted here rather than in the component for the reason at the top of
 * this file: these are figures, they have to add up to the tile above them,
 * and a test should be able to reach them without rendering a dashboard.
 *
 * `null` in, nothing out — a filtered view has no processor figure to split,
 * and a split that could not be trusted was already refused upstream.
 *
 * NO CALL IS SHOWN EVEN AT ZERO, unlike the other three. A zero there is a
 * real and welcome fact: every payment this period is accounted for by a call.
 * The other three at zero are equally real — no new deals, or nothing owed
 * from before — so all four always show, and the row always sums to the tile.
 */
export function cashBreakdownFor(
  split: CashSplit | null | undefined
): { label: string; value: string }[] | undefined {
  if (!split) return undefined;
  return [
    { label: "new", value: formatReporting(split.newCash) },
    { label: "remainder", value: formatReporting(split.remainder) },
    { label: "deposits", value: formatReporting(split.deposits) },
    { label: "no call", value: formatReporting(split.noCall) },
  ];
}
