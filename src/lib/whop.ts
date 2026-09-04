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

    for (const p of payments) {
      const gross =
        [p.final_amount, p.total, p.subtotal].find(
          (v) => typeof v === "number"
        ) ?? 0;
      const refunded =
        typeof p.refunded_amount === "number" ? p.refunded_amount : 0;
      const net = Math.max(0, (gross as number) - refunded);
      const stamp = (p.paid_at ?? p.created_at) as number | undefined;
      if (net <= 0 || typeof stamp !== "number") continue;

      const day = new Date(stamp * 1000).toISOString().slice(0, 10);
      days.push({ day, amount: net });

      // A payment with no user expanded still counts towards the totals; it
      // just cannot be tied to a call, so it does not become a buyer.
      const user = (p.user && typeof p.user === "object" ? p.user : {}) as Record<
        string,
        unknown
      >;
      const email = String(user.email ?? "").trim().toLowerCase();
      if (!email) continue;

      const billing = [p.billing_first_name, p.billing_last_name]
        .filter((part): part is string => typeof part === "string" && part.trim() !== "")
        .join(" ");

      const existing = buyers.get(email) ?? {
        email,
        name: String(user.name || user.username || ""),
        billing: "",
        paid: 0,
        refunded: 0,
        payments: 0,
        first: day,
        last: day,
      };
      // Kept from whichever payment carries one: a buyer's later renewals can
      // come through with the billing fields empty, and a name that arrived on
      // their first payment is still their name.
      if (!existing.billing && billing) existing.billing = billing;
      existing.paid += net;
      existing.refunded += refunded;
      existing.payments += 1;
      if (!existing.first || day < existing.first) existing.first = day;
      // NOT "the last one seen". The crawl is by page, not by date, so a later
      // page can hold an earlier payment — taking whichever arrived last would
      // make how quiet a buyer looks depend on how the processor paginated.
      if (!existing.last || day > existing.last) existing.last = day;
      buyers.set(email, existing);
    }

    const totalPages = body?.pagination?.total_page ?? 1;
    if (page >= totalPages) break;
  }

  return { days, buyers: [...buyers.values()] };
}
