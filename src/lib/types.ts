import { DIMENSIONS, DimensionKey } from "./dimensions";
import { LEAD_FACTORS, LeadFactorKey, leadScore } from "./lead-quality";

export interface CallRecord {
  id: string;
  name: string;
  closer: string | null;
  call_date: string | null;
  outcome: string | null;
  tier: string | null;
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
  Customer: "#d4af37",
  "No deal": "#ef4444",
  "No offer made": "#f59e0b",
  BAMFAM: "#6366f1",
  "No show": "#6b7280",
  // Crimson rather than #ef4444 so it stays distinct from "No deal" red.
  REFUND: "#e11d48",
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
