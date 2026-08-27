import { DIMENSIONS, DimensionKey } from "./dimensions";
import { LEAD_FACTORS, LeadFactorKey, leadScore } from "./lead-quality";
import { AMBER, CRIMSON, GOLD, NEGATIVE, NEUTRAL } from "./palette";

export interface CallRecord {
  id: string;
  name: string;
  /**
   * The prospect's address, lower-cased. Written by the workflow for joining
   * this call to everything else known about the person — the Calendly booking
   * that produced it, and the KPI dashboard's lead row. Empty on calls
   * recorded before the column existed, which is why every join tolerates it.
   */
  prospect_email: string | null;
  closer: string | null;
  call_date: string | null;
  /**
   * What this call is counted as. Usually what the closer typed, but a call
   * the processor says was paid for is counted as a win whatever the row says
   * — see `settle` in lib/settle.ts, and `recorded_outcome` below for the
   * original. Moayad's ruling, 2026-08-18: "even if it was a small deposit it
   * still technically counts as a close."
   */
  outcome: string | null;
  /**
   * What the closer actually typed, kept when `outcome` was settled by a
   * payment. Null on a call nothing overrode, which is almost all of them.
   *
   * Both are kept deliberately. A number that moves on its own is one a closer
   * will dispute, and they are right to — so the row can always show what was
   * recorded on the day next to what it is being counted as.
   */
  recorded_outcome?: string | null;
  /**
   * Everything the processor has received for this person, in the reporting
   * currency, when a payment was matched to this call. Null when none was.
   *
   * Revenue is floored at this: a follow-up that later paid often carries no
   * price at all, and reading `price_closed` alone would book a paid deal at
   * zero. Where a price IS recorded it wins — that is the deal value, and the
   * rest is what is still owed. The KPI dashboard applies the same floor, which
   * is what makes the two totals agree.
   */
  paid_total?: number | null;
  price_discussed: number | null;
  price_closed: number | null;
  payment_structure: string | null;
  /** Taken during the call itself. Money that landed later belongs in the two below. */
  collected_on_call: number | null;
  /** Every payment received so far, filled in by hand as instalments land. */
  cash_collected: number | null;
  outstanding: number | null;
  /** The currency every money field on this row is denominated in. */
  currency: string | null;
  /** Rate from this row's currency to the reporting currency, fixed at signing. */
  fx_rate: number | null;
  prospect_revenue: string;
  niche: string;
  location: string;
  lead_source: string | null;
  quality_score: number | null;
  duration: number | null;
  recording_url: string | null;
  summary: string;

  /** Per-dimension scores, 1-10. Null when the call predates the scorecard. */
  scores: Record<DimensionKey, number | null>;
  /**
   * Per-factor lead scores, each out of that factor's own maximum. These score
   * the prospect, not the caller — the pair is what makes a middling call
   * attributable to one or the other.
   */
  lead: Record<LeadFactorKey, number | null>;
  /** What the lead factors add up to, and the move that fits them. */
  lead_read: string;
  /** Every objection the prospect voiced. Empty when none was. */
  objections: string[];
  /** The one that decided the call. Null when it closed or none was raised. */
  primary_objection: string | null;
  flags: {
    value_leak: boolean;
    follow_up_trap: boolean;
    early_price_drop: boolean;
    weakest_belief: string | null;
  };
  the_moment: string;
  next_call_drill: string;
  /** Link to the call's Notion page, where the full written breakdown lives. */
  notion_url: string;
  /**
   * Whose product was sold, decided by the scorer from the transcript.
   *
   * Every other field says HOW the call went. This one says whether the call
   * was this client's business at all — a closer who sells two products books
   * both into one calendar, and nothing else on the row can tell them apart.
   * Null on any row scored before the field existed, which is read the same as
   * "unclear": counted, not hidden.
   */
  offer_match: string | null;
  offer_evidence: string;
}

/** True when the call has a full set of dimension scores to render. */
export function isScored(call: CallRecord): boolean {
  return DIMENSIONS.every((d) => call.scores[d.key] != null);
}

/** Mean of a call's dimension scores, or null if it was never scored. */
export function overallScore(call: CallRecord): number | null {
  const values = DIMENSIONS.map((d) => call.scores[d.key]).filter(
    (v): v is number => v != null
  );
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * The lead's score out of 100, or null when too little of the call was about
 * the prospect to judge them.
 *
 * Derived from the factor columns rather than read from Notion's `Lead Score`.
 * That column exists so the tracker can be sorted and filtered inside Notion,
 * but the factors are the source of truth: correct one by hand and the total
 * here follows, instead of disagreeing with its own breakdown.
 */
export function leadQualityScore(call: CallRecord): number | null {
  return leadScore(call.lead);
}

/** True when enough of the lead was assessed to show a score for it. */
export function hasLeadScore(call: CallRecord): boolean {
  return leadQualityScore(call) != null;
}

/**
 * True when this call was reviewed by a rubric that assessed the lead at all.
 *
 * It doubles as the marker for rows that carry objection data, because the same
 * review writes both. Without it, every call scored before the lead half
 * existed would land in the "no objection was raised" bucket and quietly halve
 * every objection rate on the board.
 */
export function hasLeadAssessment(call: CallRecord): boolean {
  return LEAD_FACTORS.some((f) => call.lead[f.key] != null);
}

/** The lead factor furthest below its own ceiling, for "what was missing". */
export function weakestLeadFactor(call: CallRecord) {
  const scored = LEAD_FACTORS.filter((f) => call.lead[f.key] != null);
  if (scored.length === 0) return null;
  return scored.reduce((worst, f) =>
    (call.lead[f.key] as number) / f.max < (call.lead[worst.key] as number) / worst.max ? f : worst
  );
}

export const OUTCOME_COLORS: Record<string, string> = {
  Customer: GOLD,
  "No deal": NEGATIVE,
  "No offer made": AMBER,
  BAMFAM: "#6366f1",
  "No show": NEUTRAL,
  // Crimson rather than the "No deal" red, so the two stay apart in a legend
  // where they sit next to each other: a refund is not a lost deal.
  REFUND: CRIMSON,
};

export const OUTCOMES = [
  "Customer",
  "No deal",
  "No offer made",
  "BAMFAM",
  "No show",
  "REFUND",
] as const;

/** Outcomes that mean the prospect actually showed up and heard an offer. */
export const OFFER_MADE_OUTCOMES = new Set(["Customer", "BAMFAM", "No deal", "REFUND"]);
