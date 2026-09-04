/**
 * The payment processor's own record of money in, read server-side.
 *
 * The tracker's Cash Collected column is typed by closers after the fact and
 * drifts low — instalments land weeks later and nobody goes back to the row.
 * Whop is where the money actually moved, so the Cash Collected tile reads
 * from here when a key is present, and the tracker's figure is shown beside
 * it as the discrepancy rather than the answer.
 *
 * Two shapes come back from one read. `days` is day + amount and nothing else,
 * which is all the tile needs to sum a date range. `buyers` carries the name
 * and address as well, because naming *which* rows disagree is the difference
 * between a number someone frowns at and a list someone can work through — and
 * those names are already on the call table, so nothing new is being exposed.
 */

import { accountKey, cachedRead, cacheSecondsFrom } from "./live-cache";
// The one reader of the payment processor, shared with the check scripts.
import { readPayment } from "../../scripts/lib/live-read.mjs";

const WHOP_V2 = process.env.WHOP_API_V2_BASE ?? "https://api.whop.com/api/v2";

/**
 * How long a read of the payment history stands before a re-read is started
 * behind the reader. The crawl is 50 payments a page and strictly sequential,
 * so it lengthens by a page every fifty sales — measured at 2.15s across three
 * pages on 2026-08-27, and it was the single slowest thing on the dashboard.
 * Sixty seconds matches the refresh this page already runs on. See
 * live-cache.ts.
 */
const DEFAULT_CACHE_SECONDS = 60;
const MAX_STALE_MS = 10 * 60_000;

export interface PaymentDay {
  /** YYYY-MM-DD the payment was made. */
  day: string;
  /** Gross less anything refunded, in USD. */
  amount: number;
}

export interface WhopBuyer {
  /** Lower-cased, and the only join key the tracker and the processor share. */
  email: string;
  name: string;
  /**
   * The name on the card, which is the only real one.
   *
   * `name` above is the processor's display name and is usually a handle —
   * "kokitosh", "liamb48", "stonyartisan82" — which matches nothing on a call
   * row. The billing name is the person ("George Segovia", "Liam Beauchamps")
   * and rides on every payment. Not fetching it is why this dashboard matched
   * "John Jones" to a different John who paid $500 in June while the real John
   * Jones's $3,000 sat unclaimed, and why four genuine cash gaps never
   * appeared on the page at all. See `scripts/lib/buyer-match.mjs`.
   */
  billing: string;
  /** Everything they have paid, net of refunds. */
  paid: number;
  /**
   * How much of that was given back.
   *
   * `paid` is already net of it, which is right for a cash total and dangerous
   * for a balance: a customer who paid $2,000 and was refunded $1,667 arrives
   * here as one who has paid $333, and against a $2,000 deal that reads as
   * $1,667 still owed. It is the opposite — the money came and went. Live on
   * this account, 2026-09-04: two refunds, and one of them was on the chase
   * list for $1,667 nobody was owed. See lib/collect.ts.
   */
  refunded: number;
  /** How many separate payments make that up. */
  payments: number;
  /** The earliest payment, YYYY-MM-DD. */
  first: string | null;
  /**
   * Every payment they have made, as day and amount.
   *
   * `paid` above is the lifetime total, which can answer what a buyer is worth
   * and cannot answer what arrived in August. The cash split needs the second
   * question — a payment belongs to the period it landed in, and the deal it
   * belongs to may have closed months earlier — so the individual payments
   * travel rather than only their sum. Net of refunds, same as `paid`, so the
   * list and the total can never disagree about what a payment was worth.
   *
   * Day and amount only: this rides through the matcher into MatchedPayment,
   * which deliberately carries nothing that identifies a person.
   */
  history: PaymentDay[];
  /**
   * The most recent payment, YYYY-MM-DD.
   *
   * The tracker records no date a payment is DUE — there is no such column, and
   * on a plan agreed in conversation there is often no such date anywhere. So
   * the only thing that can say whether a part-paid deal is still moving is
   * when money last arrived, which is what the collect list is ordered by. See
   * lib/collect.ts.
   */
  last: string | null;
}

export interface WhopRead {
  days: PaymentDay[];
  buyers: WhopBuyer[];
}

export function isWhopConfigured(cfg?: { apiKey: string | null }): boolean {
  // Whop settles in dollars. Feeding those into a dashboard reporting in
  // another currency would silently mix currencies — the exact fault the FX
  // banner exists to catch — so a non-USD install keeps the tracker figure.
  const reporting = process.env.NEXT_PUBLIC_REPORTING_CURRENCY ?? "USD";
  return Boolean(cfg ? cfg.apiKey : process.env.WHOP_API_KEY) && reporting === "USD";
}

/**
 * Every paid payment, as daily totals and as buyers. Throws on a refused route
 * so the caller can degrade to the tracker figure and say why, rather than
 * render a half-fetched total as if it were the whole.
 */
export async function queryPayments(cfg?: { apiKey: string | null }): Promise<WhopRead> {
  const key = cfg ? cfg.apiKey : process.env.WHOP_API_KEY;
  if (!key) throw new Error("WHOP_API_KEY is not set");

  return cachedRead(accountKey("whop", key), () => crawlPayments(key), {
    ttlMs: cacheSecondsFrom("WHOP_CACHE_SECONDS", DEFAULT_CACHE_SECONDS) * 1000,
    maxStaleMs: MAX_STALE_MS,
  });
}

/** Every page of the payment history, read fresh. Callers go through queryPayments. */
async function crawlPayments(key: string): Promise<WhopRead> {
  const days: PaymentDay[] = [];
  const buyers = new Map<string, WhopBuyer>();

  // v2, not v1: v1's payments route refuses a company API key outright
  // whatever its permissions. 200 pages of 50 is a ceiling, not a target.
  for (let page = 1; page <= 200; page++) {
    const url = new URL(`${WHOP_V2}/payments`);
    url.searchParams.set("per", "50");
    url.searchParams.set("page", String(page));
    url.searchParams.set("status", "paid");
    // The buyer's email rides on the user expand, and email is the only key
    // the tracker and the processor have in common.
    url.searchParams.set("expand[]", "user");

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}` },
      // ONE CACHE, AND IT IS OURS. This used to be `next: { revalidate: 60 }`,
      // which left two layers holding the same answer with different clocks:
      // a background refresh could be handed a minute-old page by Next and
      // stamp it as read just now, so "how old is this figure" had two
      // answers. queryPayments above is the only place that question is
      // answered now.
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Whop refused the payments route (${res.status})`);
    }

    const body = await res.json();
    const payments: Record<string, unknown>[] = Array.isArray(body)
      ? body
      : (body.data ?? []);
    if (payments.length === 0) break;

    for (const raw of payments) {
      /* THE SAME READER THE CHECK SCRIPTS USE, not a second one.
         This loop had its own copy of the field extraction, and on 2026-09-04
         the two turned out to disagree about the one field that decides whether
         a shortfall is a debt: scripts/lib/live-read.mjs keeps `refunded` per
         payment — its comment says why, "never paid" and "paid and was
         refunded" are different facts — and this copy netted it off and threw
         it away. A customer who paid $2,000 in full and was given $1,667 back
         reached the collect list as somebody owing $1,667.
         Two readers of one processor is the same fault the buyer matcher had,
         fixed the same way: one implementation, imported by both sides. */
      const p = readPayment(raw);
      if (p.net <= 0 || !p.day) continue;

      days.push({ day: p.day, amount: p.net });

      // A payment with no user expanded still counts towards the totals; it
      // just cannot be tied to a call, so it does not become a buyer.
      if (!p.email) continue;

      const existing = buyers.get(p.email) ?? {
        email: p.email,
        name: p.handle,
        billing: "",
        paid: 0,
        refunded: 0,
        payments: 0,
        history: [],
        first: p.day,
        last: p.day,
      };
      // Kept from whichever payment carries one: a buyer's later renewals can
      // come through with the billing fields empty, and a name that arrived on
      // their first payment is still their name.
      if (!existing.billing && p.billing) existing.billing = p.billing;
      existing.paid += p.net;
      existing.refunded += p.refunded;
      existing.payments += 1;
      existing.history.push({ day: p.day, amount: p.net });
      if (!existing.first || p.day < existing.first) existing.first = p.day;
      // NOT "the last one seen". The crawl is by page, not by date, so a later
      // page can hold an earlier payment — taking whichever arrived last would
      // make how quiet a buyer looks depend on how the processor paginated.
      if (!existing.last || p.day > existing.last) existing.last = p.day;
      buyers.set(p.email, existing);
    }

    const totalPages = body?.pagination?.total_page ?? 1;
    if (page >= totalPages) break;
  }

  return { days, buyers: [...buyers.values()] };
}
