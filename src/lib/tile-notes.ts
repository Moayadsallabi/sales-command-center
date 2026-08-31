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
  return `${funnel.booked} booked in this window, ${funnel.canceled} cancelled`;
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
  return {
    source: "whop",
    note:
      gap > 0
        ? `closers logged ${formatReporting(
            bank.trackerLogged
          )}, so ${formatReporting(gap)} has no call behind it`
        : `closers logged ${formatReporting(
            bank.trackerLogged
          )}, ${formatReporting(-gap)} of that isn't in Whop`,
  };
}
