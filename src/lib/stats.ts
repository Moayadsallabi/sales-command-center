import { CallRecord, overallScore } from "./types";
import { DIMENSIONS, DimensionKey } from "./dimensions";

export const UNASSIGNED = "Unassigned";

export interface CloserStats {
  closer: string;
  /** Every call in range, including no-shows. */
  calls: number;
  /** Calls where the prospect turned up — the denominator for close rate. */
  taken: number;
  customers: number;
  /** Percentage, 0-100. Null when the closer has no calls taken yet. */
  closeRate: number | null;
  cashCollected: number;
  revenue: number;
  /** Mean overall score across that closer's scored calls. */
  avgScore: number | null;
  scoredCalls: number;
  /** Mean per dimension, null where the closer has no scored calls. */
  dimensionAverages: Record<DimensionKey, number | null>;
  /** The dimension this closer scores lowest on. Null until scored. */
  weakest: { key: DimensionKey; name: string; score: number } | null;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Mean per dimension across a set of calls, ignoring unscored ones. */
export function dimensionAverages(
  calls: CallRecord[]
): Record<DimensionKey, number | null> {
  const averages = {} as Record<DimensionKey, number | null>;
  for (const dimension of DIMENSIONS) {
    averages[dimension.key] = mean(
      calls
        .map((c) => c.scores[dimension.key])
        .filter((v): v is number => v != null)
    );
  }
  return averages;
}

function statsFor(closer: string, calls: CallRecord[]): CloserStats {
  const taken = calls.filter((c) => c.outcome !== "No show");
  const customers = calls.filter((c) => c.outcome === "Customer");
  const averages = dimensionAverages(calls);

  const scored = DIMENSIONS.map((d) => ({ dimension: d, score: averages[d.key] })).filter(
    (entry): entry is { dimension: (typeof DIMENSIONS)[number]; score: number } =>
      entry.score != null
  );

  // Ties resolve to the earlier dimension, which is stable across renders
  // because DIMENSIONS is a fixed order.
  const lowest = scored.reduce<(typeof scored)[number] | null>(
    (worst, entry) => (worst === null || entry.score < worst.score ? entry : worst),
    null
  );

  return {
    closer,
    calls: calls.length,
    taken: taken.length,
    customers: customers.length,
    closeRate: taken.length > 0 ? (customers.length / taken.length) * 100 : null,
    cashCollected: customers.reduce((sum, c) => sum + (c.cash_collected ?? 0), 0),
    revenue: customers.reduce((sum, c) => sum + (c.price_closed ?? 0), 0),
    avgScore: mean(
      calls.map(overallScore).filter((v): v is number => v != null)
    ),
    scoredCalls: calls.filter((c) => overallScore(c) != null).length,
    dimensionAverages: averages,
    weakest: lowest
      ? { key: lowest.dimension.key, name: lowest.dimension.name, score: lowest.score }
      : null,
  };
}

/** One row per closer, ordered by cash collected. */
export function closerLeaderboard(calls: CallRecord[]): CloserStats[] {
  const byCloser = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const key = call.closer ?? UNASSIGNED;
    const bucket = byCloser.get(key);
    if (bucket) bucket.push(call);
    else byCloser.set(key, [call]);
  }

  return [...byCloser.entries()]
    .map(([closer, closerCalls]) => statsFor(closer, closerCalls))
    .sort((a, b) => b.cashCollected - a.cashCollected || b.calls - a.calls);
}

/**
 * How often a closer's weakest dimensions repeat. This is the thing a single
 * call review cannot tell you: one bad score is a bad call, the same dimension
 * bottoming out across many calls is a habit.
 */
export function recurringWeakness(
  calls: CallRecord[]
): { key: DimensionKey; name: string; callsBelowSix: number; share: number } | null {
  const scored = calls.filter((c) => overallScore(c) != null);
  if (scored.length < 3) return null;

  const counts = DIMENSIONS.map((dimension) => {
    const below = scored.filter((c) => {
      const score = c.scores[dimension.key];
      return score != null && score < 6;
    }).length;
    return { key: dimension.key, name: dimension.name, callsBelowSix: below };
  });

  const worst = counts.reduce((a, b) => (b.callsBelowSix > a.callsBelowSix ? b : a));
  if (worst.callsBelowSix < 2) return null;

  return { ...worst, share: worst.callsBelowSix / scored.length };
}
