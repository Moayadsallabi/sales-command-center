import { CallRecord } from "./types";
import { PaymentDay } from "./whop";
import { carriesCash, reportingCollected } from "./money";

export interface SeriesPoint {
  /** YYYY-MM-DD. For a bucketed series, the first day in the bucket. */
  day: string;
  value: number;
  /** Days rolled into this point. 1 unless the window was long enough to bucket. */
  days: number;
}

/** Most points a sparkline can show before they stop being distinguishable. */
const MAX_POINTS = 90;

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split("T")[0];
}

/** Whole days from `from` to `to` inclusive — the 9th to the 9th is one day. */
function span(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * A day-by-day total across the whole window, zero-filled.
 *
 * EMPTY DAYS ARE THE POINT. Plotting only the days money arrived turns four
 * scattered payments into a rising line with no gaps in it, which is the exact
 * opposite of what happened. A day with nothing in it is drawn at zero.
 *
 * Long windows are BUCKETED, never sampled: "All time" over two years is
 * summed into equal blocks of days so every pound is still on the chart. A
 * sampled series would drop whole payments and quietly redraw the shape.
 */
export function dailyTotals(
  from: string,
  to: string,
  totals: Map<string, number>
): SeriesPoint[] {
  const length = span(from, to);
  if (length < 1) return [];

  const perBucket = Math.ceil(length / MAX_POINTS);
  const out: SeriesPoint[] = [];

  for (let start = 0; start < length; start += perBucket) {
    const days = Math.min(perBucket, length - start);
    let value = 0;
    for (let i = 0; i < days; i++) {
      value += totals.get(addDays(from, start + i)) ?? 0;
    }
    out.push({ day: addDays(from, start), value, days });
  }

  return out;
}

/**
 * Bounds for a series when the window has none — "All time" has no first or
 * last day of its own, so it borrows the data's. Null when there is no dated
 * row to borrow from, which is the empty dashboard.
 */
function boundsOf(days: string[]): { from: string; to: string } | null {
  if (days.length === 0) return null;
  let from = days[0];
  let to = days[0];
  for (const day of days) {
    if (day < from) from = day;
    if (day > to) to = day;
  }
  return { from, to };
}

/**
 * The cash line under the headline figure, from whichever source that figure
 * came from.
 *
 * THE CHART AND THE NUMBER ABOVE IT MUST AGREE. The tile shows the processor's
 * total when Whop is connected and nothing is filtered, and the closers' own
 * total otherwise — so the series is built from the same source under the same
 * condition. Drawing a Whop line under a tracker total would be two different
 * answers stacked on top of each other, which is the fault this dashboard
 * spent a day removing.
 */
export function cashSeries(
  window: { from: string | null; to: string | null },
  payments: PaymentDay[] | null,
  calls: CallRecord[]
): SeriesPoint[] {
  const totals = new Map<string, number>();

  if (payments) {
    for (const p of payments) {
      totals.set(p.day, (totals.get(p.day) ?? 0) + p.amount);
    }
  } else {
    for (const call of calls) {
      if (!call.call_date || !carriesCash(call)) continue;
      totals.set(
        call.call_date,
        (totals.get(call.call_date) ?? 0) + reportingCollected(call)
      );
    }
  }

  const from = window.from ?? boundsOf([...totals.keys()])?.from ?? null;
  const to = window.to ?? boundsOf([...totals.keys()])?.to ?? null;
  if (from === null || to === null) return [];

  return dailyTotals(from, to, totals);
}
