/**
 * WHAT THIS PERIOD'S CASH IS ACTUALLY MADE OF.
 *
 * ---------------------------------------------------------------------------
 * WHY ONE CASH NUMBER IS NOT ENOUGH
 *
 * Cash Collected answers "how much money arrived" and is silently read as "how
 * much did we sell", which are different questions in any business taking
 * payment plans. A month where nothing closed and every instalment landed on
 * time looks identical to a month of new deals paid in full. Brey's tracker on
 * 2026-09-04 held 26 calls on instalments and 29 on a custom structure against
 * 3 paid in full, so the two questions come apart on this account every month.
 *
 * The split names the four things a payment can be:
 *
 *   NEW        the call behind it is a win that did not close before this
 *              period — this period's selling
 *   REMAINDER  the call behind it is a win that closed BEFORE this period —
 *              an older deal still paying
 *   DEPOSITS   the call behind it is not a win — money taken while booking a
 *              follow-up, which is in the bank whatever the row says
 *   NO CALL    no call could be tied to it at all — the coverage gap, in cash
 *
 * ---------------------------------------------------------------------------
 * THE FOUR SUM TO THE TILE, AND THAT IS THE TEST
 *
 * A breakdown that does not add up to the number above it is the fault this
 * dashboard has shipped twice (see lib/tile-notes.ts). So NO CALL is not
 * counted — it is what is LEFT of the processor's total once the other three
 * are taken off it, which makes the identity true by construction rather than
 * by agreement between two counts.
 *
 * That only works while the other three are counted from payments the
 * processor also counted in the total. They are: both sides come from the same
 * crawl, and both are net of refunds.
 *
 * ---------------------------------------------------------------------------
 * IT REFUSES RATHER THAN GUESSES
 *
 * If the three attributed figures come to more than the total, something has
 * been counted twice — one buyer's payments claimed by two calls, most likely
 * — and every figure here is then wrong in a way that still adds up on screen.
 * This returns null in that case, and the tile shows its total with no
 * breakdown. A refusal and a real zero must never render identically
 * [CLAUDE.md, 2026-08-25]; here a refusal shows nothing at all.
 */
import { CallRecord } from "./types";
import { DateWindow, withinWindow } from "./periods";
import { MatchedPayment } from "./reconcile";
import { isWin } from "./money";

export interface CashSplit {
  /** Payments in the window on a deal that had not closed before it. */
  newCash: number;
  /** Payments in the window on a deal that closed before the window opened. */
  remainder: number;
  /** Payments in the window against a call that is not a win. */
  deposits: number;
  /** Everything left of the processor's total: payments with no call behind them. */
  noCall: number;
}

/**
 * A dollar of slack before an over-attributed split is called one.
 *
 * Both sides are the same numbers added in a different order, so the only gap
 * that can appear honestly is floating-point noise. Anything larger is a
 * double count.
 */
const ROUNDING_SLACK = 1;

/**
 * Whether this call had already closed when the window opened.
 *
 * A window open at the start has no "before", so nothing can be a remainder in
 * it — an all-time view is all one deal history and every payment belongs to
 * the deal it was made against.
 *
 * A win with no call date cannot be placed, and is treated as NEW rather than
 * dropped: it is a real deal whose money is in the total either way, and
 * putting it in the bucket that means "this period's selling" overstates the
 * period rather than losing the money. The recording supplies this date on
 * every live row, so this is a guard, not a case.
 */
function closedBefore(call: CallRecord, window: DateWindow): boolean {
  if (window.from === null) return false;
  if (!call.call_date) return false;
  return call.call_date < window.from;
}

/**
 * The four parts of one window's cash, or null when they cannot be trusted.
 *
 * `collected` is the processor's own total for the same window — the figure on
 * the tile — and is what NO CALL is derived from. Pass the matched calls for
 * the WHOLE history, not the window: a deal closed in June is exactly what
 * REMAINDER exists to name, and filtering it out upstream would empty that
 * bucket and quietly move its money into NO CALL.
 */
export function cashSplit(
  matched: MatchedPayment[],
  collected: number,
  window: DateWindow
): CashSplit | null {
  let newCash = 0;
  let remainder = 0;
  let deposits = 0;

  for (const m of matched) {
    const inWindow = m.history
      .filter((p) => withinWindow(p.day, window))
      .reduce((sum, p) => sum + p.amount, 0);
    if (inWindow === 0) continue;

    // NOT WIN-ONLY. A deposit taken while booking a follow-up is money that
    // moved, and lib/money.ts already counts it in the cash total for that
    // reason. Skipping non-wins here would leave it inside the total and
    // outside every bucket, which reads as money with no call behind it.
    //
    // A PARTLY-REFUNDED DEAL LANDS HERE TOO, and it is the one row this bucket
    // names imperfectly. The processor's total is net of refunds, so a fully
    // refunded buyer nets to zero and never reaches this loop at all; a
    // partial refund leaves a residual that IS inside the tile's total and has
    // to be somewhere. "Money against a call that did not win" is true of it,
    // which is this bucket. None existed on the live account the day this
    // shipped; if they become common the honest fix is a fifth figure, not a
    // quieter label.
    if (!isWin(m.call)) deposits += inWindow;
    else if (closedBefore(m.call, window)) remainder += inWindow;
    else newCash += inWindow;
  }

  const attributed = newCash + remainder + deposits;
  if (attributed > collected + ROUNDING_SLACK) return null;

  return {
    newCash,
    remainder,
    deposits,
    // Never negative by the guard above, and never counted independently —
    // see the header. This is the money the processor banked that no call on
    // the tracker explains.
    noCall: Math.max(0, collected - attributed),
  };
}
