/**
 * Builders for test calls and buyers.
 *
 * A CallRecord has fifty-odd fields and a test cares about three of them, so
 * these fill in the rest with something inert. Anything a test asserts on it
 * passes in explicitly — a default that a test silently depends on is a test
 * that stops meaning what it says the day the default changes.
 */
import { CallRecord } from "../src/lib/types";
import { DIMENSIONS, DimensionKey } from "../src/lib/dimensions";
import { LEAD_FACTORS, LeadFactorKey } from "../src/lib/lead-quality";
import { WhopBuyer } from "../src/lib/whop";

function blankScores(): Record<DimensionKey, number | null> {
  return Object.fromEntries(DIMENSIONS.map((d) => [d.key, null])) as Record<
    DimensionKey,
    number | null
  >;
}

function blankLead(): Record<LeadFactorKey, number | null> {
  return Object.fromEntries(LEAD_FACTORS.map((f) => [f.key, null])) as Record<
    LeadFactorKey,
    number | null
  >;
}

/** Every dimension at the same score, for tests about good vs poor calls. */
export function scoresAt(value: number): Record<DimensionKey, number | null> {
  return Object.fromEntries(DIMENSIONS.map((d) => [d.key, value])) as Record<
    DimensionKey,
    number | null
  >;
}

/** Every lead factor at its own ceiling times `fraction`. */
export function leadAt(fraction: number): Record<LeadFactorKey, number | null> {
  return Object.fromEntries(
    LEAD_FACTORS.map((f) => [f.key, Math.round(f.max * fraction)])
  ) as Record<LeadFactorKey, number | null>;
}

let seq = 0;

export function call(over: Partial<CallRecord> = {}): CallRecord {
  seq += 1;
  return {
    id: `call-${seq}`,
    name: `Prospect ${seq}`,
    prospect_email: null,
    closer: "Tpan",
    call_date: "2026-08-10",
    outcome: "No deal",
    price_discussed: null,
    price_closed: null,
    payment_structure: null,
    collected_on_call: null,
    cash_collected: null,
    outstanding: null,
    currency: null,
    fx_rate: null,
    prospect_revenue: "",
    niche: "",
    location: "",
    lead_source: null,
    quality_score: null,
    duration: null,
    recording_url: null,
    summary: "",
    scores: blankScores(),
    lead: blankLead(),
    lead_read: "",
    objections: [],
    primary_objection: null,
    flags: {
      value_leak: false,
      follow_up_trap: false,
      early_price_drop: false,
      weakest_belief: null,
    },
    the_moment: "",
    next_call_drill: "",
    notion_url: "",
    ...over,
  };
}

export function buyer(over: Partial<WhopBuyer> = {}): WhopBuyer {
  return {
    email: "buyer@example.com",
    name: "A Buyer",
    paid: 2000,
    payments: 1,
    first: "2026-08-10",
    ...over,
  };
}
