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

/** Below this, a difference is fees or rounding rather than a mistake. */
/**
 * What a deposit has to reach before a payment settles an open call as won.
 * Shared with `scripts/check-payments.mjs`, which applies the same floor when
 * it reconciles the tracker by hand.
 */
export const MIN_DEPOSIT = 100;

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

  const matches = matchAll(calls, byEmail, haystacks);
  const claimed = new Set([...matches.values()].map((m) => m.buyer.email));

  const missedCloses: Disagreement[] = [];
  const cashOff: Disagreement[] = [];

  for (const call of calls) {
    const match = matches.get(call);
    if (!match) continue;

    const found: Disagreement = {
      call,
      paid: match.buyer.paid,
      payments: match.buyer.payments,
      certain: match.certain,
    };

    if (call.outcome !== "Customer" && call.outcome !== "REFUND") {
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
    worth:
      missedCloses.reduce((sum, m) => sum + m.paid, 0) +
      cashOff.reduce((sum, m) => sum + Math.abs(m.paid - (collectedToDate(m.call) ?? 0)), 0),
  };
}
