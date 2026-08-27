import {
  CallRecord,
  overallScore,
  leadQualityScore,
  hasLeadAssessment,
} from "./types";
import { DIMENSIONS, Dimension, DimensionKey, GOOD_SCORE } from "./dimensions";
import { OBJECTION_TYPES, LEAD_MAX } from "./lead-quality";
import {
  carriesCash,
  carriesRevenue,
  closeRateOf,
  heldCalls,
  isWin,
  reportingCollected,
  reportingRevenue,
} from "./money";

export const UNASSIGNED = "Unassigned";

/** Below this, a dimension counts as having gone wrong on that call. */
export const POOR_SCORE = 6;

/**
 * At or above this, a WHOLE CALL scored well. Gold above it, amber down to
 * POOR_SCORE, red below that.
 *
 * [STATED — Moayad, chat 2026-08-27: "7.5 and above is good"] — asked because
 * the number was written by hand in four places and one of them said 8, so a
 * call scored 7.7 showed gold on the leaderboard and amber in the call table.
 * Same call, two verdicts, and the comment above the leaderboard's copy said
 * "same thresholds everywhere". A rule typed out four times is four rules that
 * happen to agree today.
 *
 * NOT dimensions.GOOD_SCORE, WHICH IS 7 AND MEANS SOMETHING ELSE: that one is
 * the cut for a SINGLE PART of a call being done well, and it splits calls into
 * cohorts for the dimension-impact analysis. Two thresholds on the same 0-10
 * scale, measuring different things, so they carry different names. Sharing the
 * name "GOOD_SCORE" between them is how one silently becomes the other.
 */
export const GOOD_CALL_SCORE = 7.5;

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

/**
 * Close rate over whatever set a panel hands in.
 *
 * The rule for which calls count lives in `money.ts` and is shared with the
 * KPI cards, so no panel can quietly answer this differently — no-shows and
 * refunds are dropped here rather than by each caller remembering to.
 */
const closeRate = closeRateOf;

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
  revenue: number;
  avgScore: number | null;
  scoredCalls: number;
  /** Change in average score against the previous window of the same length. */
  trend: number | null;
  dimensionAverages: Record<DimensionKey, number | null>;
  weakest: { dimension: Dimension; score: number } | null;
  /**
   * The average quality of the leads this closer was handed. Two closers can
   * only be compared on close rate once this is on the same row — a lower close
   * rate against a lower lead score is not the same finding as a lower close
   * rate against the same one.
   */
  avgLeadScore: number | null;
  /** How many of their calls had a lead assessment behind that average. */
  leadScoredCalls: number;
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
  const taken = heldCalls(calls);
  const customers = calls.filter(isWin);
  const paying = calls.filter(carriesCash);
  const averages = dimensionAverages(calls);

  const now = mean(calls.map(overallScore).filter((v): v is number => v != null));
  const before = mean(
    previous.map(overallScore).filter((v): v is number => v != null)
  );

  const leadScores = calls
    .map(leadQualityScore)
    .filter((v): v is number => v != null);

  // Naming someone's weakest habit needs more than one call to have seen it.
  // The costing panel has always applied this bar; the leaderboard did not, so
  // a closer with a single scored call was still being told what they are worst
  // at — off one reading, on one prospect, on one day.
  const scored = scoredCalls(calls).length;
  const enoughToJudge = scored >= MIN_CALLS_PER_CLOSER;

  return {
    closer,
    calls: calls.length,
    taken: taken.length,
    customers: customers.length,
    closeRate: closeRate(taken),
    // Cash counts money that moved on any of their calls, revenue only their
    // wins — see carriesCash. Totalling both over customers hid deposits taken
    // while booking a follow-up, and made this table disagree with the call list.
    cashCollected: paying.reduce((sum, c) => sum + reportingCollected(c), 0),
    revenue: calls
      .filter(carriesRevenue)
      .reduce((sum, c) => sum + reportingRevenue(c), 0),
    avgScore: now,
    scoredCalls: scored,
    trend: now != null && before != null ? now - before : null,
    dimensionAverages: averages,
    weakest: enoughToJudge ? weakestOf(averages) : null,
    avgLeadScore: mean(leadScores),
    leadScoredCalls: leadScores.length,
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
  // heldCalls first: this panel used to measure close rate over every scored
  // call, no-shows and refunds included, while three panels beside it did not.
  const scored = scoredCalls(heldCalls(calls));
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
      goodCloses: good.filter(isWin).length,
      poorCloseRate: poorRate,
      poorCalls: poor.length,
      poorCloses: poor.filter(isWin).length,
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

/* ------------------------------------------------------------ lead quality */

/** Calls whose lead was assessed and turned up. No-shows have no lead score. */
function leadAssessed(calls: CallRecord[]): CallRecord[] {
  return heldCalls(calls).filter(
    (c) => hasLeadAssessment(c) && leadQualityScore(c) != null
  );
}

export interface LeadBucket {
  calls: number;
  closes: number;
  closeRate: number;
  /** Mean lead score in this half, so the split is readable as a number. */
  avgScore: number;
}

export interface LeadImpactResult {
  ready: boolean;
  /** Calls with a lead score behind them. */
  assessed: number;
  callsShort: number;
  /** The lead score the two halves are split at — this account's own median. */
  splitAt: number;
  better: LeadBucket;
  worse: LeadBucket;
  gap: number;
  swing: number;
  conclusive: boolean;
}

/**
 * Close rate on the better half of this account's leads against the worse half.
 *
 * The split is the account's own median rather than a fixed threshold, so both
 * halves are always populated and the comparison holds whether the leads are
 * uniformly good or uniformly poor. A fixed cut at, say, 55 would put every
 * call on one side for an account whose traffic is consistent, and then report
 * a comparison it never actually made.
 */
export function leadImpact(calls: CallRecord[]): LeadImpactResult {
  const assessed = leadAssessed(calls);
  const scores = assessed
    .map((c) => leadQualityScore(c) as number)
    .sort((a, b) => a - b);

  const empty: LeadBucket = { calls: 0, closes: 0, closeRate: 0, avgScore: 0 };
  const short = Math.max(0, MIN_SCORED_FOR_IMPACT - assessed.length);

  if (scores.length === 0) {
    return {
      ready: false, assessed: 0, callsShort: MIN_SCORED_FOR_IMPACT, splitAt: 0,
      better: empty, worse: empty, gap: 0, swing: 0, conclusive: false,
    };
  }

  const splitAt = scores[Math.floor(scores.length / 2)];
  // Ties go to the worse half, so an account where most leads share a score
  // reports a small better-half rather than splitting identical calls at random.
  const better = assessed.filter((c) => (leadQualityScore(c) as number) > splitAt);
  const worse = assessed.filter((c) => (leadQualityScore(c) as number) <= splitAt);

  const bucket = (list: CallRecord[]): LeadBucket => ({
    calls: list.length,
    closes: list.filter(isWin).length,
    closeRate: closeRate(list) ?? 0,
    avgScore: mean(list.map((c) => leadQualityScore(c) as number)) ?? 0,
  });

  const b = bucket(better);
  const w = bucket(worse);
  const gap = b.closeRate - w.closeRate;
  const swing =
    Math.min(b.calls, w.calls) === 0 ? 100 : 100 / Math.min(b.calls, w.calls);

  return {
    ready:
      assessed.length >= MIN_SCORED_FOR_IMPACT &&
      b.calls >= MIN_PER_BUCKET &&
      w.calls >= MIN_PER_BUCKET,
    assessed: assessed.length,
    callsShort: short,
    splitAt,
    better: b,
    worse: w,
    gap,
    swing,
    conclusive: Math.abs(gap) >= swing,
  };
}

export { LEAD_MAX };

/* ------------------------------------------------------------- objections */

export interface ObjectionStat {
  name: string;
  /** The buying belief it points at, for reading it against the scorecard. */
  belief: string | null;
  /** Calls where the prospect voiced it. */
  calls: number;
  /** Share of assessed calls where it came up. */
  frequency: number;
  closes: number;
  /** Close rate on the calls where it was raised. */
  closeRate: number;
  /** Calls where it was the objection that decided the outcome. */
  decided: number;
}

export interface ObjectionResult {
  ready: boolean;
  /** Calls with objection data behind them. */
  assessed: number;
  callsShort: number;
  /** Close rate across all assessed calls, as the line to compare against. */
  baseCloseRate: number;
  stats: ObjectionStat[];
}

/**
 * How often each objection comes up and what it costs when it does.
 *
 * This is the panel that reads as an offer problem rather than a closer
 * problem: an objection that appears on half the calls and drops the close rate
 * whenever it does is being created upstream — by the price, the targeting or
 * the pitch — and no amount of objection-handling drill fixes it at the call.
 */
export function objectionStats(calls: CallRecord[]): ObjectionResult {
  // Only calls a v1.5+ review looked at. Older rows have an empty objection
  // list because nothing asked, not because nothing was raised.
  const assessed = heldCalls(calls).filter(hasLeadAssessment);
  const base = closeRate(assessed) ?? 0;

  const stats: ObjectionStat[] = OBJECTION_TYPES.filter((t) => t.belief !== null)
    .map((type) => {
      const raised = assessed.filter((c) => c.objections.includes(type.name));
      return {
        name: type.name,
        belief: type.belief,
        calls: raised.length,
        frequency: assessed.length === 0 ? 0 : (raised.length / assessed.length) * 100,
        closes: raised.filter(isWin).length,
        closeRate: closeRate(raised) ?? 0,
        decided: assessed.filter((c) => c.primary_objection === type.name).length,
      };
    })
    .filter((s) => s.calls > 0)
    .sort((a, b) => b.calls - a.calls);

  return {
    ready: assessed.length >= MIN_SCORED_FOR_IMPACT && stats.length > 0,
    assessed: assessed.length,
    callsShort: Math.max(0, MIN_SCORED_FOR_IMPACT - assessed.length),
    baseCloseRate: base,
    stats,
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
  const scored = scoredCalls(heldCalls(calls));
  if (scored.length === 0) return [];

  const averages = dimensionAverages(scored);
  const previousAverages = dimensionAverages(scoredCalls(heldCalls(previousCalls)));
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
