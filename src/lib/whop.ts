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

const WHOP_V2 = process.env.WHOP_API_V2_BASE ?? "https://api.whop.com/api/v2";

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
  /** Everything they have paid, net of refunds. */
  paid: number;
  /** How many separate payments make that up. */
  payments: number;
  /** The earliest payment, YYYY-MM-DD. */
  first: string | null;
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
      // The tile is a running total, not a live feed. A minute of staleness
      // is invisible; hammering the route on every render is not.
      next: { revalidate: 60 },
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

      const existing = buyers.get(email) ?? {
        email,
        name: String(user.name || user.username || ""),
        paid: 0,
        payments: 0,
        first: day,
      };
      existing.paid += net;
      existing.payments += 1;
      if (!existing.first || day < existing.first) existing.first = day;
      buyers.set(email, existing);
    }

    const totalPages = body?.pagination?.total_page ?? 1;
    if (page >= totalPages) break;
  }

  return { days, buyers: [...buyers.values()] };
}
