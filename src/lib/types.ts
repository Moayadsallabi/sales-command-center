export interface CallRecord {
  id: string;
  name: string;
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
