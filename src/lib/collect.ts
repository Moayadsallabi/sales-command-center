/**
 * The deals that are part paid, and how long since anybody heard from them.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * A payment plan is a whole sale on the day it is signed — revenue counts it in
 * full, and the money view has always shown what is outstanding as a total. A
 * total is not a job. The second half of a split deal is visible here as a
 * slightly smaller Cash collected and nowhere as a person to ring, so nothing
 * on this page has ever asked anyone to go and collect it.
 * [STATED — Moayad, chat 2026-09-03: "we wanna know which people we gotta
 * follow up with to collect on their payment plans"]
 *
 * ---------------------------------------------------------------------------
 * THERE IS NO DUE DATE ANYWHERE, SO THIS IS ORDERED BY SILENCE
 *
 * The tracker has no column for when the next payment falls due, and on a plan
 * agreed out loud on a call there is usually no such date written down at all.
 * Inventing one — assuming thirty days, or splitting the price by the number of
 * payments — would put a number on the screen that nobody agreed to, and being
 * wrong about a date is how a customer who is paying to schedule gets chased.
 *
 * So the question this answers is not "who is late", which the data cannot
 * support. It is "who has gone quiet": how long since money last arrived from
 * this person, longest first. That is a fact, it is the same fact a person
 * would use to decide who to ring, and it degrades honestly — a buyer paying
 * every month sinks to the bottom of the list on their own.
 *
 * The two marks below are where a silence starts being worth a message. They
 * are judgement, not measurement, and the panel says so rather than dressing
 * them up as deadlines.
 *
 * ---------------------------------------------------------------------------
 * WHICH FIGURE IS "PAID"
 *
 * The processor's, wherever a payment could be tied to the call: Whop owns
 * money, and the tracker's Cash Collected is typed by hand after the fact and
 * drifts low — instalments land weeks later and nobody goes back to the row,
 * which is exactly the population this list is made of. Where no payment
 * matched, the tracker's own figure is used and the row SAYS it is the
 * tracker's, because the difference between "they still owe $2,000" and "the
 * closer typed $2,000 in June" is the difference between a call worth making
 * and an argument.
 */
import { CallRecord } from "./types";
import { MatchedPayment } from "./reconcile";
import { isWin, reportingClosed, reportingCollected } from "./money";

/** Days of silence before a part-paid deal is worth a message. */
export const COLLECT_QUIET_DAYS = 30;
/** And before it is worth worrying about. */
export const COLLECT_COLD_DAYS = 60;

/**
 * Balances smaller than this are rounding, not debt.
 *
 * The same floor the cash reconciliation uses for "these two figures disagree",
 * for the same reason: a processor's fee, a currency conversion or a rounded
 * price leaves a few pounds behind on a deal that is finished, and a chase list
 * with a $12 row on it stops being read.
 */
export const COLLECT_FLOOR = 50;

export interface Balance {
  call: CallRecord;
  /** The deal agreed, converted for totalling. */
  price: number;
  /** What has arrived against it, converted for totalling. */
  paid: number;
  /** price − paid, always above COLLECT_FLOOR. */
  owed: number;
  /**
   * WHAT TIES THIS ROW TO THE MONEY, which is what decides whether the balance
   * beside it can be trusted enough to ring somebody about.
   *
   *   email    a payment was tied to this call by the prospect's address. The
   *            strongest thing this system produces, and the only one that
   *            needs no caveat.
   *   name     tied on the name alone, because the address on the row matched
   *            no buyer. A lone wrong answer looks exactly like a confident
   *            right one, so it is marked.
   *   unfound  the row carries an address and the processor has no payment
   *            against it. Either they genuinely have not paid, or they paid
   *            under another address — and the figure shown is the closer's
   *            typing rather than the bank.
   *   no_email nothing could be looked up at all. This is the shape a
   *            duplicated row takes, and the shape of a row named "Unknown".
   *   unread   no payment processor was consulted, for this client or at all.
   *            Every figure is then the tracker's and none of the three grades
   *            above means anything — "no payment found" would claim a search
   *            that never happened. Said once at the top of the panel instead
   *            of on all seventeen rows.
   */
  evidence: "email" | "name" | "unfound" | "no_email" | "unread";
  /** How many payments the processor has seen. Null when it found none. */
  payments: number | null;
  /**
   * What the tracker row itself claims was collected, when that disagrees with
   * the processor by more than the rounding floor. Null when they agree or
   * when there is nothing to compare against.
   *
   * Named rather than silently overridden: a closer whose row says one thing
   * while the screen says another will dispute the number, and they are right
   * to. Live case — a row typed $1,060 while $1,560 had arrived, so trusting
   * the row would have chased $500 that was already banked.
   */
  trackerSays: number | null;
  /**
   * The day money last arrived, when anything knows it.
   *
   * Null in two different situations, and the panel must not draw them the
   * same way: nobody has paid anything, or somebody has paid and no date was
   * recorded. The tracker's Cash Collected is a running total with no date
   * beside it, so an unmatched row can hold $3,375 and know nothing about when
   * it came. Saying "nothing yet" over that figure states a payment never
   * happened while the same row shows it did.
   */
  lastPaid: string | null;
  /**
   * Days of silence, and which clock it was measured on. A payment date when
   * there is one, the call otherwise — that is the best available marker, but
   * "40 days since we last saw money" and "40 days since the conversation" are
   * different claims, so the row says which it is making.
   */
  quiet: number;
  clockFrom: "payment" | "call";
}

export interface CollectResult {
  /** Whether the payment processor was consulted at all — see `collectable`. */
  processorRead: boolean;
  /** Longest quiet first. */
  items: Balance[];
  /** What the list is worth. */
  owed: number;
  /** How many are past the two marks. */
  quiet: number;
  cold: number;
  /**
   * Wins carrying no price at all, so nothing can say whether they owe
   * anything — including the ones money HAS arrived against, since a payment
   * against an untyped price proves nothing about what was agreed. Counted
   * rather than dropped: a deal with no price is invisible to this list
   * whatever is outstanding on it, and that is a gap in the tracker rather
   * than a customer who has paid.
   */
  unpriced: number;
  /**
   * Rows carrying no prospect email, whose figure is therefore the tracker's
   * own and whose balance nothing has checked.
   *
   * With no address the matcher has only a name to work with, and this is the
   * shape a duplicated row takes: Brey's tracker holds "Danny" on 10 August
   * with an email and "Danny Johnson" on the 13th without one, both marked
   * Customer at $4,000, and the second is almost certainly the same sale
   * written up twice. Left unsaid, this panel turns that into a person to ring
   * about $4,000 that was never owed. Counted so the reader checks the row
   * before making the call — and because putting the address on the row is the
   * fix, after which the money checks itself.
   */
  uncheckable: number;
  /**
   * Rows resting on anything weaker than an address match.
   *
   * Published as a headline number rather than left to the per-row notes,
   * because the cost of this list being wrong is somebody's afternoon and a
   * customer told they owe money they have paid. Live on 2026-09-04 it is 9 of
   * 23 — a third of the list, which is not a footnote.
   */
  needsChecking: number;
  /**
   * Deals where money came and went again.
   *
   * A refund makes a paid deal look part paid: the processor's total is net of
   * it, so $2,000 received and $1,667 given back reads as $333 paid against a
   * $2,000 price — a $1,667 balance nobody is owed. Live on 2026-09-04 that
   * was one row on this list, with a name and a closer beside it.
   *
   * Pulled out rather than shown, because the number is not a debt and no
   * amount of labelling makes it safe to put in a column headed Still owed.
   * The row needs correcting to REFUND on the tracker, which is what the
   * count says.
   */
  refunded: { count: number; value: number };
}

/** Whole days from `date` to `today`, both YYYY-MM-DD. Negative clamps to 0. */
function daysBetween(date: string, today: string): number {
  const from = Date.parse(`${date}T00:00:00Z`);
  const to = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.max(0, Math.round((to - from) / 864e5));
}

/**
 * Every won deal that is not paid in full, longest quiet first.
 *
 * Takes the unfiltered call list. A balance does not stop being owed when the
 * date filter moves, and unlike the follow-up list it does not expire at the
 * end of the month either — an unpaid instalment from June is still money.
 * The panel says the date range does not apply, in the same words the
 * follow-up list uses.
 *
 * `matched` is reconcile's output rather than a second matcher. Tying a payment
 * to a call when the two systems share no identifier is the hard part and it is
 * solved once, refusals included; a private copy here would agree with it until
 * the day it did not.
 */
export function collectable(
  calls: CallRecord[],
  matched: MatchedPayment[],
  today: string,
  /**
   * Whether the payment processor was read at all. False for a client with no
   * Whop key, for one reporting in a currency Whop does not settle in, and on
   * any load where the crawl failed — see isWhopConfigured and loadPayments.
   * An empty `matched` alone cannot tell "nobody has paid" from "nobody
   * looked", and those want opposite sentences.
   */
  processorRead = true
): CollectResult {
  // KEYED BY ID, NOT BY THE OBJECT. reconcile runs before settle, and settle
  // returns a NEW record for every row it promotes — so the call inside a match
  // is not the same object as the one in this list, and an identity map would
  // silently lose the processor's figure for exactly the rows a payment was
  // found for. settle.ts can key by identity because it is the thing doing the
  // replacing; nothing downstream of it can.
  const byCall = new Map<string, MatchedPayment>();
  for (const m of matched) byCall.set(m.call.id, m);

  const items: Balance[] = [];
  let unpriced = 0;
  const refunded = { count: 0, value: 0 };

  for (const call of calls) {
    if (!isWin(call)) continue;

    const price = reportingClosed(call);
    const match = byCall.get(call.id);
    const paid = match ? match.paid : reportingCollected(call);

    // No price means no commitment to measure the money against, so nothing
    // here can say what is left — whether money arrived or not. Counted in
    // full rather than only when the row also shows no cash: a deal with an
    // untyped price and a payment against it is not thereby settled, it is
    // unknowable, and quietly dropping those is how a list gets shorter than
    // the truth without saying so.
    if (price <= 0) {
      unpriced += 1;
      continue;
    }

    const owed = price - paid;
    if (owed <= COLLECT_FLOOR) continue;

    // MONEY THAT CAME AND WENT IS NOT MONEY OWED. See `refunded` above: the
    // processor's total is net of the refund, so a refunded customer arrives
    // here looking part paid. Counted and removed rather than labelled, since
    // the figure is not a debt in any wording.
    if (match && match.refunded > 0) {
      refunded.count += 1;
      refunded.value += match.refunded;
      continue;
    }

    const lastPaid = match?.last ?? null;
    // Falling back to the call date rather than skipping the row: a deal agreed
    // on a call and never paid at all is the single most collectable thing on
    // this list, and it is the one with no payment to date it by.
    const clock = lastPaid ?? call.call_date;

    // What the closer typed, kept beside what arrived whenever the two differ
    // by more than rounding. Only meaningful where a payment was found: with
    // nothing to compare against, the tracker's figure IS the figure.
    const typed = reportingCollected(call);
    const trackerSays =
      match && Math.abs(typed - match.paid) >= COLLECT_FLOOR ? typed : null;

    items.push({
      call,
      price,
      paid,
      owed,
      evidence: !processorRead
        ? "unread"
        : match
        ? match.certain
          ? "email"
          : "name"
        : String(call.prospect_email ?? "").trim()
        ? "unfound"
        : "no_email",
      payments: match ? match.payments : null,
      trackerSays,
      lastPaid,
      quiet: clock ? daysBetween(clock, today) : 0,
      clockFrom: lastPaid ? "payment" : "call",
    });
  }

  // Longest quiet first, and the larger balance first inside a tie: two rows
  // silent for the same seven weeks are the same job, and the one holding
  // $3,000 is the one to ring.
  items.sort((a, b) => (b.quiet - a.quiet) || (b.owed - a.owed));

  return {
    processorRead,
    items,
    owed: items.reduce((sum, i) => sum + i.owed, 0),
    quiet: items.filter((i) => i.quiet >= COLLECT_QUIET_DAYS).length,
    cold: items.filter((i) => i.quiet >= COLLECT_COLD_DAYS).length,
    unpriced,
    uncheckable: items.filter((i) => i.evidence === "no_email").length,
    // Zero when nothing was read, because the caveat is then about the whole
    // panel rather than about particular rows, and it is stated once.
    needsChecking: processorRead
      ? items.filter((i) => i.evidence !== "email").length
      : 0,
    refunded: { count: refunded.count, value: Math.round(refunded.value) },
  };
}
