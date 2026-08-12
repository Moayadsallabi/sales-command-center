import { DIMENSIONS, DimensionKey } from "./dimensions";

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
  cash_collected: number | null;
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
