/**
 * Where the tracker and the payment processor disagree about a deal.
 *
 * The tracker records what a call looked like at the moment it ended. Money
 * does not respect that boundary: a prospect marked BAMFAM on Tuesday pays on
 * Friday and nothing goes back to change Tuesday's row. Close rate and revenue
 * are then built from the state of play on the day of the call, which is not
 * the state of play now.
 *
 * `npm run check:payments` has found these for a while, and it can write the
 * corrections back. What it could not do was tell anyone the list existed —
 * it only speaks when someone runs it. This is the same comparison, on the
 * page, so the question "is anything owed a ruling" is a glance instead of a
 * weekly chore.
 *
 * The matching logic is LITERALLY the script's — `scripts/lib/buyer-match.mjs`,
 * imported by both — including its refusals: a tie between two candidates is
 * dropped rather than guessed at, and one shared word off a two-word name is
 * not a match at all, because sending someone to edit the wrong prospect's row
 * is worse than a gap.
 *
 * IT USED TO SAY "deliberately the same as the script's" AND BE A SECOND COPY,
 * and the two drifted apart in both directions on Brey's live August. That file
 * opens with what each divergence cost. Do not re-implement any of it here.
 */

import { CallRecord } from "./types";
import { WhopBuyer, PaymentDay } from "./whop";
import { collectedToDate } from "./money";
import { MIN_DEPOSIT, REFUND_OUTCOME } from "./sales-rules";
import {
  matchBuyers,
  corroborationOf,
  CORROBORATION_ORDER,
  CASH_TOLERANCE,
  type Corroboration,
} from "../../scripts/lib/buyer-match.mjs";

/**
 * What a deposit has to reach before a payment settles an open call as won.
 * Shared with `scripts/check-payments.mjs`, which applies the same floor when
 * it reconciles the tracker by hand.
 */
export { MIN_DEPOSIT };

export interface Disagreement {
  call: CallRecord;
  /** What the processor has for this person, net of refunds. */
  paid: number;
  /** How many separate payments make that up. */
  payments: number;
  /** False when the two were tied together on a name rather than an address. */
  certain: boolean;
  /**
   * How much that name match is worth, judged against the deal price — a
   * figure neither the matcher nor the cash test reads, so its agreement is a
   * genuinely second opinion. `unpriced` is the one to look at: it means the
   * row offered nothing to check the name against, which is the shape both of
   * the matches that were wrong in August had.
   */
  corroboration: Corroboration;
}

/**
 * A win and what the processor has actually received against it.
 *
 * Published for every call the matcher tied to a buyer, not only the ones that
 * DISAGREE with the tracker — the two lists above are about faults, and a deal
 * being half paid is not a fault, it is a job. lib/collect.ts turns these into
 * the chase list.
 *
 * Carries no email and no address. The buyer list is matched on the server
 * precisely so it does not travel; this is the part of it a panel needs.
 */
export interface MatchedPayment {
  call: CallRecord;
  /** Everything this person has paid, net of refunds. Lifetime, not windowed. */
  paid: number;
  /** How much was given back. A shortfall made of refund is not a debt. */
  refunded: number;
  /** How many separate payments make that up. */
  payments: number;
  /**
   * Those payments as day and amount, so a period can be counted.
   *
   * `paid` is a lifetime total and cannot say what arrived inside a window,
   * which is the whole question the cash split asks. Day and amount only —
   * this list is the reason the split exists and it identifies nobody, which
   * keeps the rule in the paragraph above intact.
   */
  history: PaymentDay[];
  /** The day the most recent one landed. */
  last: string | null;
  /** False when the tie was made on a name rather than an address. */
  certain: boolean;
}

export interface Reconciliation {
  /** Money arrived, but the row is not marked Customer. */
  missedCloses: Disagreement[];
  /** Marked Customer, but the cash figure disagrees with the processor. */
  cashOff: Disagreement[];
  /** Buyers with no call on the tracker at all — the coverage gap, not a typo. */
  untracked: number;
  untrackedWorth: number;
  /**
   * The same buyers, as records rather than a tally.
   *
   * Both figures above are LIFETIME: every buyer who has never matched a call,
   * and everything they have ever paid. That is the right shape for the panel
   * at the bottom of the page, and the wrong shape for answering "what did
   * unrecorded calls cost me this month" — which is what Moayad asked on
   * 2026-08-18, having reasonably read the lifetime number as a monthly one.
   *
   * Windowing needs a date, and only the caller knows which window is on
   * screen, so the list travels and the date filter stays where every other
   * date filter lives. Each buyer carries `first` (their earliest payment) and
   * `paid` (their lifetime total).
   */
  untrackedBuyers: WhopBuyer[];
  /** Everything the two lists are worth together, for the headline. */
  worth: number;
  /** Every matched call with the money behind it — see MatchedPayment. */
  matched: MatchedPayment[];
}

/**
 * WEAKEST EVIDENCE FIRST, then by date inside each grade.
 *
 * These were sorted by date alone, which put the row resting on nothing but a
 * first name wherever the calendar happened to place it. The list is a queue of
 * work for a person, so it is ordered by how much that person is needed.
 */
const byConfidence = (a: Disagreement, b: Disagreement) => {
  const rank =
    CORROBORATION_ORDER.indexOf(a.corroboration) -
    CORROBORATION_ORDER.indexOf(b.corroboration);
  if (rank !== 0) return rank;
  return String(a.call.call_date ?? "").localeCompare(String(b.call.call_date ?? ""));
};

export function reconcile(calls: CallRecord[], buyers: WhopBuyer[]): Reconciliation {
  // A NO-SHOW THAT LATER PAID IS NOT A CALL THAT HAPPENED.
  //
  // [sales-rules.json] "A payment proves a SALE. It does not prove that a
  // CALL HAPPENED." Matching a payment to a no-show and promoting it put the
  // same person on BOTH sides of the close rate, and flipped their booking
  // from no_show to kept in the funnel underneath. Whatever they bought, they
  // did not buy it on a call they never attended.
  //
  // Dropped BEFORE matching rather than after, for two reasons. Their buyer
  // stays unclaimed and falls through to `untracked` below — the panel whose
  // whole job is "this was paid and no call explains it" — so the money is
  // still on the page. And a buyer who no-showed once and then turned up is
  // now free to match the call they actually attended, instead of having their
  // payment held by the empty one.
  const considered = calls.filter((c) => c.outcome !== "No show");

  // Inferred, not annotated: `buyer-match.d.mts` types the boundary, so an
  // annotation here would only be a second place to keep in step.
  const matches = matchBuyers(considered, buyers, {
    emailOf: (c: CallRecord) => c.prospect_email,
    nameOf: (c: CallRecord) => c.name,
  });
  const claimed = new Set([...matches.values()].map((m) => m.buyer.email));

  const missedCloses: Disagreement[] = [];
  const cashOff: Disagreement[] = [];
  const matched: MatchedPayment[] = [];

  for (const call of considered) {
    const match = matches.get(call);
    if (!match) continue;

    matched.push({
      call,
      paid: match.buyer.paid,
      refunded: match.buyer.refunded,
      payments: match.buyer.payments,
      history: match.buyer.history,
      last: match.buyer.last,
      certain: match.certain,
    });

    const found: Disagreement = {
      call,
      paid: match.buyer.paid,
      payments: match.buyer.payments,
      certain: match.certain,
      corroboration: corroborationOf(match.certain, call.price_closed, match.buyer.paid),
    };

    if (call.outcome !== "Customer" && call.outcome !== REFUND_OUTCOME) {
      // A token payment does not turn an open call into a won one.
      // [STATED — Moayad, 2026-08-18] "even if a deposit doesnt pay the rest,
      // its still technically a close unless its under $100 i think then that
      // we shouldnt count as a close." Above the floor the size of the deposit
      // stops mattering — a closer who banked a real one has closed, whether or
      // not the balance ever lands.
      if (match.buyer.paid >= MIN_DEPOSIT) missedCloses.push(found);
    } else if (
      call.outcome === "Customer" &&
      Math.abs((collectedToDate(call) ?? 0) - match.buyer.paid) >= CASH_TOLERANCE
    ) {
      cashOff.push(found);
    }
  }

  missedCloses.sort(byConfidence);
  cashOff.sort(byConfidence);

  const untracked = buyers.filter((b) => !claimed.has(b.email));

  return {
    missedCloses,
    cashOff,
    untracked: untracked.length,
    untrackedWorth: untracked.reduce((sum, b) => sum + b.paid, 0),
    untrackedBuyers: untracked,
    worth: worthOf(missedCloses, cashOff),
    matched,
  };
}

/**
 * What the two disagreement lists are worth together.
 *
 * A missed close is worth everything that arrived, because none of it is on the
 * page. A cash-off row is only worth the DIFFERENCE — the deal is already
 * counted, and only the figure on it is wrong. Adding its full amount would
 * double-count money the dashboard already has.
 */
function worthOf(missedCloses: Disagreement[], cashOff: Disagreement[]): number {
  return (
    missedCloses.reduce((sum, m) => sum + m.paid, 0) +
    cashOff.reduce(
      (sum, m) => sum + Math.abs(m.paid - (collectedToDate(m.call) ?? 0)),
      0
    )
  );
}

/**
 * THE SAME RECONCILIATION, NARROWED TO ONE DATE RANGE.
 *
 * The panel that renders this used to ignore the date buttons entirely, on the
 * reasoning that an unruled payment does not stop being owed when the filter
 * moves. True, and beside the point: with "This month" selected it listed a
 * call from 23 July, and nothing on the page told a reader that one panel out
 * of ten had opted out. [STATED — Moayad, chat 2026-08-28: "u shouldnt be
 * showing me ones from july, if i have this month clicked it needs to respect
 * time periods".] Widening the dates brings the older rows back.
 *
 * THE TWO HALVES ARE PLACED BY DIFFERENT DATES, BECAUSE THEY COUNT DIFFERENT
 * THINGS. A disagreement is about a tracker row, so it is placed by its CALL
 * date — the same date every other filter on the page uses. An untracked buyer
 * has no call to be placed by, which is exactly what makes them untracked, so
 * they are placed by their first payment.
 *
 * `untrackedWorth` STAYS A LIFETIME TOTAL. A buyer carries what they have paid
 * in all, not what they paid inside a window, so windowing the list cannot
 * window the money. The sentence in the panel says "first paid in this period"
 * and gives the total separately rather than implying it all landed here.
 *
 * `keep` is passed in rather than imported so this file stays free of the
 * date-window machinery — the caller already owns the window on screen.
 */
export function windowReconciliation(
  reconciliation: Reconciliation,
  keep: (date: string | null | undefined) => boolean
): Reconciliation {
  const missedCloses = reconciliation.missedCloses.filter((d) =>
    keep(d.call.call_date)
  );
  const cashOff = reconciliation.cashOff.filter((d) => keep(d.call.call_date));
  // Narrowed with the rest, by its call date, so nothing handed a windowed
  // reconciliation can read a wider set out of it than the object claims to
  // hold. The collect list does not want it narrowed and therefore reads the
  // unwindowed reconciliation — see the ACT band in dashboard.tsx.
  const matched = reconciliation.matched.filter((m) => keep(m.call.call_date));
  const untrackedBuyers = reconciliation.untrackedBuyers.filter((b) =>
    keep(b.first)
  );

  return {
    missedCloses,
    cashOff,
    untracked: untrackedBuyers.length,
    untrackedWorth: untrackedBuyers.reduce((sum, b) => sum + b.paid, 0),
    untrackedBuyers,
    worth: worthOf(missedCloses, cashOff),
    matched,
  };
}
