import { CallRecord, overallScore } from "./types";
import { DIMENSIONS, Dimension, DimensionKey, GOOD_SCORE } from "./dimensions";
import {
  reportingCashOnCall,
  reportingCollected,
  reportingRevenue,
} from "./money";

export const UNASSIGNED = "Unassigned";

/** Below this, a dimension counts as having gone wrong on that call. */
export const POOR_SCORE = 6;

/**
 * How many scored calls a comparison needs before it is worth showing. Close
 * rates on five calls swing wildly; showing them invites someone to act on
 * noise, so anything below this reports how far off it is instead.
 */
export const MIN_SCORED_FOR_IMPACT = 20;
export const MIN_PER_BUCKET = 5;
/** A closer needs this many scored calls before we call anything their habit. */
export const MIN_CALLS_PER_CLOSER = 3;

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function scoredCalls(calls: CallRecord[]): CallRecord[] {
  return calls.filter((c) => overallScore(c) != null);
}

function closeRate(calls: CallRecord[]): number | null {
  if (calls.length === 0) return null;
  return (calls.filter((c) => c.outcome === "Customer").length / calls.length) * 100;
}

/* ------------------------------------------------------------- per closer */

export interface CloserStats {
  closer: string;
  calls: number;
  /** Calls where the prospect turned up — the denominator for close rate. */
  taken: number;
  customers: number;
  closeRate: number | null;
  /** Every payment received on these deals so far, in the reporting currency. */
  cashCollected: number;
  /** The subset of that taken during the call itself — the closer's own number. */
  cashOnCall: number;
  revenue: number;
  avgScore: number | null;
  scoredCalls: number;
  /** Change in average score against the previous window of the same length. */
  trend: number | null;
  dimensionAverages: Record<DimensionKey, number | null>;
  weakest: { dimension: Dimension; score: number } | null;
}

export function dimensionAverages(
  calls: CallRecord[]
): Record<DimensionKey, number | null> {
  const averages = {} as Record<DimensionKey, number | null>;
  for (const dimension of DIMENSIONS) {
    averages[dimension.key] = mean(
      calls.map((c) => c.scores[dimension.key]).filter((v): v is number => v != null)
    );
  }
  return averages;
}

function weakestOf(
  averages: Record<DimensionKey, number | null>
): { dimension: Dimension; score: number } | null {
  const scored = DIMENSIONS.map((dimension) => ({
    dimension,
    score: averages[dimension.key],
  })).filter((e): e is { dimension: Dimension; score: number } => e.score != null);

  // Ties resolve to the earlier dimension, stable because DIMENSIONS is ordered.
  return scored.reduce<{ dimension: Dimension; score: number } | null>(
    (worst, entry) => (worst === null || entry.score < worst.score ? entry : worst),
    null
  );
}

function statsFor(
  closer: string,
  calls: CallRecord[],
  previous: CallRecord[]
): CloserStats {
  const taken = calls.filter((c) => c.outcome !== "No show");
  const customers = calls.filter((c) => c.outcome === "Customer");
  const averages = dimensionAverages(calls);

  const now = mean(calls.map(overallScore).filter((v): v is number => v != null));
  const before = mean(
    previous.map(overallScore).filter((v): v is number => v != null)
  );

  return {
    closer,
    calls: calls.length,
    taken: taken.length,
    customers: customers.length,
    closeRate: closeRate(taken),
    cashCollected: customers.reduce((sum, c) => sum + reportingCollected(c), 0),
    cashOnCall: customers.reduce((sum, c) => sum + reportingCashOnCall(c), 0),
    revenue: customers.reduce((sum, c) => sum + reportingRevenue(c), 0),
    avgScore: now,
    scoredCalls: scoredCalls(calls).length,
    trend: now != null && before != null ? now - before : null,
    dimensionAverages: averages,
    weakest: weakestOf(averages),
  };
}

function groupByCloser(calls: CallRecord[]): Map<string, CallRecord[]> {
  const byCloser = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const key = call.closer ?? UNASSIGNED;
    const bucket = byCloser.get(key);
    if (bucket) bucket.push(call);
    else byCloser.set(key, [call]);
  }
  return byCloser;
}

/**
 * One row per closer, ordered by cash collected. `previousCalls` is the window
 * immediately before the one being shown, and only drives the trend column.
 */
export function closerLeaderboard(
  calls: CallRecord[],
  previousCalls: CallRecord[] = []
): CloserStats[] {
  const previousByCloser = groupByCloser(previousCalls);

  return [...groupByCloser(calls).entries()]
    .map(([closer, closerCalls]) =>
      statsFor(closer, closerCalls, previousByCloser.get(closer) ?? [])
    )
    .sort((a, b) => b.cashCollected - a.cashCollected || b.calls - a.calls);
}

/* ------------------------------------------------------- what it is worth */

export interface DimensionImpact {
  dimension: Dimension;
  /** Close rate on calls where this was done well (score of 7 or better). */
  goodCloseRate: number;
  goodCalls: number;
  goodCloses: number;
  /** Close rate on calls where it was not. */
  poorCloseRate: number;
  poorCalls: number;
  poorCloses: number;
  /** Percentage points between the two. The number that argues for itself. */
  gap: number;
  /**
   * How far the smaller bucket's close rate moves if one call in it had gone
   * the other way. On buckets this size that is 8–20 points, which is wider
   * than most of the gaps — so it is the bar a gap has to clear.
   */
  swing: number;
  /** Whether the gap is bigger than that one call. */
  conclusive: boolean;
}

export interface ImpactResult {
  ready: boolean;
  /** How many more scored calls are needed before this means anything. */
  callsShort: number;
  scored: number;
  impacts: DimensionImpact[];
}

/**
 * Close rate when a dimension was done well against when it was not, measured
 * on this account's own calls. This is the only thing on the dashboard that
 * shows a score is worth money rather than asserting it.
 */
export function dimensionImpact(calls: CallRecord[]): ImpactResult {
  const scored = scoredCalls(calls);
  const impacts: DimensionImpact[] = [];

  for (const dimension of DIMENSIONS) {
    const good = scored.filter((c) => (c.scores[dimension.key] ?? 0) >= GOOD_SCORE);
    const poor = scored.filter((c) => {
      const score = c.scores[dimension.key];
      return score != null && score < GOOD_SCORE;
    });

    // A split with almost nothing on one side is not a comparison.
    if (good.length < MIN_PER_BUCKET || poor.length < MIN_PER_BUCKET) continue;

    const goodRate = closeRate(good) ?? 0;
    const poorRate = closeRate(poor) ?? 0;
    const gap = goodRate - poorRate;
    // The smaller bucket is the fragile one, so it sets the bar.
    const swing = 100 / Math.min(good.length, poor.length);
    impacts.push({
      dimension,
      goodCloseRate: goodRate,
      goodCalls: good.length,
      goodCloses: good.filter((c) => c.outcome === "Customer").length,
      poorCloseRate: poorRate,
      poorCalls: poor.length,
      poorCloses: poor.filter((c) => c.outcome === "Customer").length,
      gap,
      swing,
      conclusive: gap >= swing,
    });
  }

  return {
    ready: scored.length >= MIN_SCORED_FOR_IMPACT && impacts.length > 0,
    callsShort: Math.max(0, MIN_SCORED_FOR_IMPACT - scored.length),
    scored: scored.length,
    // Gaps that clear their own noise first, each group widest gap down.
    impacts: impacts.sort(
      (a, b) => Number(b.conclusive) - Number(a.conclusive) || b.gap - a.gap
    ),
  };
}

/* ------------------------------------------------------ what is costing you */

export interface Cost {
  dimension: Dimension;
  average: number;
  /** Calls where this scored below 6. */
  callsPoor: number;
  scored: number;
  /** Whether every closer is weak here, or only some of them. */
  scope: "team" | "individual" | "unknown";
  /** Named only when the weakness is individual. */
  closers: string[];
  /** Close-rate cost, when the gap is big enough to outlast a single call. */
  gap: number | null;
  /** Change against the previous window of the same length. */
  trend: number | null;
}

/**
 * The dimensions actually worth acting on, worst first. Everything sitting at
 * the same middling number as everything else is left out — a score identical
 * to seven other scores tells you nothing.
 */
export function biggestCosts(
  calls: CallRecord[],
  previousCalls: CallRecord[] = [],
  limit = 2
): Cost[] {
  const scored = scoredCalls(calls);
  if (scored.length === 0) return [];

  const averages = dimensionAverages(scored);
  const previousAverages = dimensionAverages(scoredCalls(previousCalls));
  const impacts = dimensionImpact(calls);
  // Only a gap that survived its own noise gets quoted as a cost — this panel
  // states it as a flat fact, with none of the impact panel's hedging.
  const gapFor = (key: DimensionKey) => {
    if (!impacts.ready) return null;
    const impact = impacts.impacts.find((i) => i.dimension.key === key);
    return impact?.conclusive ? impact.gap : null;
  };

  // Which closers are weak here, among those with enough calls to judge.
  const byCloser = [...groupByCloser(scored).entries()].filter(
    ([, list]) => list.length >= MIN_CALLS_PER_CLOSER
  );

  const costs: Cost[] = DIMENSIONS.map((dimension) => {
    const average = averages[dimension.key];
    if (average == null) return null;

    const weakClosers = byCloser
      .filter(([, list]) => {
        const value = mean(
          list.map((c) => c.scores[dimension.key]).filter((v): v is number => v != null)
        );
        return value != null && value < GOOD_SCORE;
      })
      .map(([closer]) => closer);

    let scope: Cost["scope"] = "unknown";
    if (byCloser.length >= 2) {
      scope = weakClosers.length === byCloser.length ? "team" : "individual";
    }

    const previousAverage = previousAverages[dimension.key];

    return {
      dimension,
      average,
      callsPoor: scored.filter((c) => {
        const score = c.scores[dimension.key];
        return score != null && score < POOR_SCORE;
      }).length,
      scored: scored.length,
      scope,
      closers: scope === "individual" ? weakClosers : [],
      gap: gapFor(dimension.key),
      trend: previousAverage == null ? null : average - previousAverage,
    };
  }).filter((c): c is Cost => c !== null);

  return costs
    .filter((c) => c.average < GOOD_SCORE || c.callsPoor > 0)
    .sort((a, b) => a.average - b.average)
    .slice(0, limit);
}
