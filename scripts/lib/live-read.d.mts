/**
 * The types for `live-read.mjs`.
 *
 * Same reason as buyer-match.d.mts: without it every field the dashboard reads
 * off this module resolves to `any`, and an `any` crossing a module boundary is
 * not "untyped" — it is a place where the annotations on the other side become
 * silent assertions. That is precisely how the dashboard came to drop `refunded`
 * while the check script kept it.
 */

/** One payment, reduced to the fields anything here reads. */
export interface ReadPayment {
  /** Lower-cased, or null when the payment carries no expanded user. */
  email: string | null;
  /** Gross less anything refunded — what stayed collected. */
  net: number;
  gross: number;
  /** Money given back. Never merely netted off: see the module header. */
  refunded: number;
  /** YYYY-MM-DD, or null when the payment carries no usable timestamp. */
  day: string | null;
  /** The name on the card, which is the only one that matches a call row. */
  billing: string;
  /** The processor's display name, usually a handle. */
  handle: string;
  /** Whop's own label for the charge. `subscription_cycle` is a renewal. */
  reason: string | null;
  /** Which product the money was for. */
  product: string | null;
}

export function readPayment(raw: Record<string, unknown>): ReadPayment;

export interface TrackerRow {
  id: string;
  name: string;
  email: string | null;
  date: string | null;
  closer: string | null;
  outcome: string | null;
  priceClosed: number | null;
  cash: number;
  onCall: number;
  url: string;
}

export function readTracker(opts: { notionKey: string; databaseId: string }): Promise<TrackerRow[]>;

export interface ReadBuyer {
  email: string;
  name: string;
  billing: string;
  paid: number;
  refunded: number;
  gross: number;
  payments: number;
  first: string | null;
  last: string | null;
  products: Set<string>;
  history: { day: string | null; amount: number; reason: string | null; product: string | null }[];
}

export function readPayments(opts: { whopKey: string; maxPages?: number }): Promise<Map<string, ReadBuyer>>;

export class LiveReadError extends Error {
  hint?: string;
}
