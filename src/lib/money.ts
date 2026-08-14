import { CallRecord } from "./types";

/**
 * Every money column in Notion holds the deal's own currency: a €3,000
 * retainer is stored as 3000 with `Currency` set to EUR. Adding those numbers
 * straight together would total euros with dollars, so anything that
 * aggregates across calls goes through the reporting helpers below, which
 * apply each row's FX Rate first.
 */
export const REPORTING_CURRENCY =
  process.env.NEXT_PUBLIC_REPORTING_CURRENCY ?? "USD";

const SYMBOLS: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };

/** Formats an amount in its own currency, never converted. */
export function formatMoney(
  amount: number | null | undefined,
  currency: string | null | undefined
): string {
  if (amount == null) return "—";
  const code = currency ?? REPORTING_CURRENCY;
  const rounded = Math.round(amount).toLocaleString();
  const symbol = SYMBOLS[code];
  return symbol ? `${symbol}${rounded}` : `${code} ${rounded}`;
}

/** Formats an already-converted amount in the reporting currency. */
export function formatReporting(amount: number): string {
  return formatMoney(amount, REPORTING_CURRENCY);
}

/**
 * A row already in the reporting currency needs no rate. Anything else uses
 * the rate captured on the row at signing; see `missingFxRate` for the case
 * where it was never filled in.
 */
function rateFor(call: CallRecord): number {
  const code = call.currency ?? REPORTING_CURRENCY;
  if (code === REPORTING_CURRENCY) return 1;
  return call.fx_rate ?? 1;
}

function toReporting(amount: number | null, call: CallRecord): number {
  if (amount == null) return 0;
  return amount * rateFor(call);
}

/* --------------------------------------------------------------- what is in */

/**
 * Cash actually taken during the call. This is the closer's number — a deal
 * signed on the call but paid three days later collected nothing on the call.
 */
export function cashOnCall(call: CallRecord): number | null {
  return call.collected_on_call;
}

/**
 * Every payment received for this deal so far. `Cash Collected` is filled in
 * by hand as later payments land; while it is blank, the only money in is
 * whatever was taken on the call itself.
 */
export function collectedToDate(call: CallRecord): number | null {
  return call.cash_collected ?? call.collected_on_call;
}

/* ------------------------------------------------- converted for totalling */

export function reportingCashOnCall(call: CallRecord): number {
  return toReporting(cashOnCall(call), call);
}

export function reportingCollected(call: CallRecord): number {
  return toReporting(collectedToDate(call), call);
}

export function reportingOutstanding(call: CallRecord): number {
  return toReporting(call.outstanding, call);
}

export function reportingRevenue(call: CallRecord): number {
  return toReporting(call.price_closed, call);
}

/* -------------------------------------------------------------- data health */

/**
 * A deal priced in another currency with no FX Rate on the row. Converting it
 * at 1:1 would quietly misstate every total it lands in — which is the exact
 * failure the currency column exists to prevent — so the dashboard names these
 * rows rather than absorbing them silently.
 */
export function missingFxRate(call: CallRecord): boolean {
  if (!call.currency || call.currency === REPORTING_CURRENCY) return false;
  return call.fx_rate == null;
}

export function callsMissingFxRate(calls: CallRecord[]): CallRecord[] {
  return calls.filter(missingFxRate);
}
