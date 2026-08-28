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
 * The matching logic is deliberately the same as the script's, including its
 * refusals: a tie between two candidates is dropped rather than guessed at,
 * because sending someone to edit the wrong prospect's row is worse than a gap.
 */

import { CallRecord } from "./types";
import { WhopBuyer } from "./whop";
import { collectedToDate } from "./money";
import { MIN_DEPOSIT, REFUND_OUTCOME } from "./sales-rules";

/** Below this, a difference is fees or rounding rather than a mistake. */
/**
 * What a deposit has to reach before a payment settles an open call as won.
 * Shared with `scripts/check-payments.mjs`, which applies the same floor when
 * it reconciles the tracker by hand.
 */
export { MIN_DEPOSIT };

const CASH_TOLERANCE = 50;
/** Short names collide. A fallback match needs a token at least this long. */
const MIN_NAME_TOKEN = 3;
/** Below this a token only counts as a whole word, never buried in another. */
const MIN_SUBSTRING_TOKEN = 5;

export interface Disagreement {
  call: CallRecord;
  /** What the processor has for this person, net of refunds. */
  paid: number;
  /** How many separate payments make that up. */
  payments: number;
  /** False when the two were tied together on a name rather than an address. */
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
}

const normalise = (s: string) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * A short name only counts as a whole word. Without that rule "Tee" matches
 * "steel" and the fallback starts inventing customers; with it, "Tee" still
 * finds "Tee Dory". Longer tokens are allowed to sit inside a word, because
 * that is how usernames are built — "beshensky" inside "bbeshensky".
 */
function tokenHits(tokens: string[], text: string): number {
  const padded = ` ${text} `;
  return tokens.filter(
    (t) => padded.includes(` ${t} `) || (t.length >= MIN_SUBSTRING_TOKEN && text.includes(t))
  ).length;
}

type Candidate = { buyer: WhopBuyer; score: number; certain: boolean };

/**
 * Every candidate pair is scored before any of them is accepted, because
 * matching row by row lets whichever row happens to come first take a payment
 * that belongs to a better match further down: a row reading "Daniel" claims
 * Jeremy Daniel's payment, and the real Jeremy Daniel row is then reported as
 * a customer who never paid.
 */
function scoreCandidates(
  call: CallRecord,
  byEmail: Map<string, WhopBuyer>,
  haystacks: { buyer: WhopBuyer; text: string }[]
): Candidate[] {
  const direct = call.prospect_email ? byEmail.get(call.prospect_email) : undefined;
  if (direct) return [{ buyer: direct, score: Infinity, certain: true }];

  const full = normalise(call.name);
  const tokens = full.split(/\s+/).filter((t) => t.length >= MIN_NAME_TOKEN);
  if (tokens.length === 0) return [];

  return haystacks
    .map(({ buyer, text }) => {
      const hits = tokenHits(tokens, text);
      // A buyer carrying the whole name outranks one sharing a single word.
      return {
        buyer,
        score: hits === 0 ? 0 : hits + (text.includes(full) ? 1 : 0),
        certain: false,
      };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Best-first assignment, skipping any row whose two best candidates tie. */
function matchAll(
  calls: CallRecord[],
  byEmail: Map<string, WhopBuyer>,
  haystacks: { buyer: WhopBuyer; text: string }[]
): Map<CallRecord, Candidate> {
  const pairs: (Candidate & { call: CallRecord })[] = [];
  for (const call of calls) {
    const ranked = scoreCandidates(call, byEmail, haystacks);
    if (ranked.length === 0) continue;
    // A tie means two different people fit equally well and nothing here can
    // tell them apart. Reporting a gap beats sending someone to the wrong row.
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) continue;
    pairs.push({ call, ...ranked[0] });
  }

  pairs.sort((a, b) => b.score - a.score);

  const byCall = new Map<CallRecord, Candidate>();
  const taken = new Set<string>();
  for (const pair of pairs) {
    if (byCall.has(pair.call) || taken.has(pair.buyer.email)) continue;
    byCall.set(pair.call, pair);
    taken.add(pair.buyer.email);
  }
  return byCall;
}

const byDate = (a: Disagreement, b: Disagreement) =>
  String(a.call.call_date ?? "").localeCompare(String(b.call.call_date ?? ""));

export function reconcile(calls: CallRecord[], buyers: WhopBuyer[]): Reconciliation {
  const byEmail = new Map(buyers.map((b) => [b.email, b]));
  const haystacks = buyers.map((buyer) => ({
    buyer,
    text: normalise(`${buyer.name} ${buyer.email.split("@")[0]}`),
  }));

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

  const matches = matchAll(considered, byEmail, haystacks);
  const claimed = new Set([...matches.values()].map((m) => m.buyer.email));

  const missedCloses: Disagreement[] = [];
  const cashOff: Disagreement[] = [];

  for (const call of considered) {
    const match = matches.get(call);
    if (!match) continue;

    const found: Disagreement = {
      call,
      paid: match.buyer.paid,
      payments: match.buyer.payments,
      certain: match.certain,
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

  missedCloses.sort(byDate);
  cashOff.sort(byDate);

  const untracked = buyers.filter((b) => !claimed.has(b.email));

  return {
    missedCloses,
    cashOff,
    untracked: untracked.length,
    untrackedWorth: untracked.reduce((sum, b) => sum + b.paid, 0),
    untrackedBuyers: untracked,
    worth: worthOf(missedCloses, cashOff),
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
  };
}
