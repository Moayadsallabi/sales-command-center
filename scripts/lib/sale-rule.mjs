/**
 * WHETHER A CALL CLOSED. ONE IMPLEMENTATION, TWO READERS.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * `sales-rules.json` settled what a close IS on 2026-09-06: money has to have
 * moved, whatever the closer typed. Both this repo's dashboard and its check
 * scripts have to obey it, and they wrote it out separately — `src/lib/money.ts`
 * enforced it from the day of the ruling, and `scripts/check-collect.mjs` did
 * not, because nobody remembered it was a second reader.
 *
 * The cost, measured on Brey 2026-09-10: the collect PANEL listed 24 people
 * owing $47,648; the CHECK on the same data listed 28 owing $63,648. The four
 * in between were calls the money rule had already demoted to follow-ups —
 * ABandZz's $8,000 among them, the very call the ruling was written about. That
 * check runs inside `npm run check:weekly`, so it published the wrong list
 * every week, and it is the list that sends a person to ring a customer.
 *
 * A shared JSON file settles what the numbers are. It cannot make two pieces of
 * code ASK the same question. This can.
 *
 * ---------------------------------------------------------------------------
 * IT TAKES ITS THRESHOLDS RATHER THAN READING THEM
 *
 * The obvious shape — read `sales-rules.json` in here — is the one that must
 * not be used. This module is imported by the bundled app as well as by plain
 * node scripts, and a `readFileSync` on a relative path inside a bundled module
 * makes Turbopack trace the whole project (that is what `loadEnv` did until it
 * was moved out of `notion-env.mjs`). So each side passes the rules it already
 * holds: the app from `lib/sales-rules.ts`, a script from its own read of the
 * JSON. Pure in, pure out, safe on both sides of the build.
 */

/**
 * THE MONEY BEHIND A CALL, from the two places it can be recorded.
 *
 * `tracked` is the tracker's own figure — Cash Collected, falling back to what
 * was taken on the call — and is typed by a person. `matched` is what the
 * payment processor holds for the buyer this call was matched to, which is the
 * stronger evidence and the reason a call the closer wrote up as a follow-up
 * can still be a sale.
 *
 * The greater of the two, never the sum: they are two accounts of the same
 * money, and adding them would count a paid deposit twice.
 */
export function moneyMoved(tracked, matched) {
  return Math.max(tracked ?? 0, matched ?? 0);
}

/**
 * Whether a call counts as a close.
 *
 * @param outcome  what the row says today, after any settlement by payment
 * @param moved    the figure from `moneyMoved` above
 * @param rules    `{ winning, refund, minDeposit }` from sales-rules.json
 *
 * A REFUND is never a win: the money went back. Otherwise the outcome has to be
 * a winning one AND the money has to have reached the deposit floor — both, in
 * that order. The floor is flat rather than a share of the price, because under
 * a percentage bar the same $500 deposit was a sale on a $2,000 deal and not
 * one on a $4,000 deal, which judges a closer by the size of the offer.
 */
export function countsAsWin(outcome, moved, { winning, refund, minDeposit }) {
  if (outcome === refund) return false;
  if (!winning.includes(outcome ?? "")) return false;
  return moved >= minDeposit;
}
