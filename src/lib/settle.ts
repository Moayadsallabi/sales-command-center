/**
 * Counting a call as won when the money says so, whatever the row says.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * An outcome is frozen at the moment the call ends. A prospect who says "let
 * me think about it" is recorded BAMFAM, pays four days later, and stays
 * BAMFAM for ever — counted as a loss, with their money outside revenue.
 *
 * `reconcile` has found these for a while and reports them at the bottom of
 * the page as rows needing a ruling. The ruling has since been made twice:
 *
 *   2026-08-17 — "it should be a closed deal if they close in the future.
 *                 Whop is the only source of truth for money."
 *   2026-08-18 — "even if it was a small deposit it still technically counts
 *                 as a close."
 *
 * The KPI dashboard implemented that ruling; this one did not, so the two
 * disagreed about the same fortnight. Measured against Brey's live account on
 * 2026-08-18: August read 15 deals / $27,950 here against 21 deals / $39,238
 * there, and every one of the six in between was someone who had actually paid.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT RE-MATCH ANYTHING
 *
 * The hard part — tying a payment to a call when the two systems share no
 * identifier — already lives in `reconcile`, refusals included: a tie between
 * two candidates is dropped rather than guessed at, a name needs two signals,
 * and one buyer can claim only one call. Re-implementing that here would give
 * the page two matchers that agree until the day they do not, so this consumes
 * reconcile's output instead of repeating its work.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CLOSER TYPED IS NEVER THROWN AWAY
 *
 * A number that moves on its own is one a closer will dispute, and they are
 * right to. `recorded_outcome` keeps what was typed on the day, so the row can
 * always show both: what it was recorded as, and what it is being counted as.
 * Correcting the tracker row in Notion remains the real fix — this stops the
 * dashboard being wrong in the meantime, it does not make the row right.
 */
import { CallRecord } from "./types";
import { Reconciliation } from "./reconcile";

/**
 * Calls with the ones the processor paid for counted as wins.
 *
 * Everything downstream — close rate, revenue, the closer leaderboard, lead
 * impact, objection stats — reads `outcome`, so settling here means all of them
 * agree without each having to know this rule exists. That is deliberate: the
 * previous shape had `outcome === "Customer"` written out in six places, and a
 * rule spelled out six times is a rule that will eventually be six rules.
 *
 * Returns the original array untouched when there is nothing to settle, so the
 * common case allocates nothing.
 */
export function settle(
  calls: CallRecord[],
  reconciliation: Reconciliation | null
): CallRecord[] {
  if (!reconciliation || reconciliation.missedCloses.length === 0) return calls;

  // `missedCloses` holds only calls whose outcome is neither Customer nor
  // REFUND and against which a payment was matched — precisely the set to
  // promote. Keyed by identity, which is safe because these are the same
  // objects reconcile was handed.
  const paidFor = new Map<CallRecord, number>();
  for (const miss of reconciliation.missedCloses) {
    paidFor.set(miss.call, miss.paid);
  }

  return calls.map((call) => {
    const paid = paidFor.get(call);
    if (paid === undefined) return call;
    return {
      ...call,
      outcome: "Customer",
      recorded_outcome: call.outcome,
      paid_total: paid,
    };
  });
}

/** Whether this row is being counted as something other than what was typed. */
export function wasSettledByPayment(call: CallRecord): boolean {
  return call.recorded_outcome != null && call.recorded_outcome !== call.outcome;
}
