/**
 * Reading the two systems that own the facts: Notion for the call, Whop for
 * the money.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHARED AND NOT COPIED
 *
 * These readers lived inside check-payments.mjs, which was the only thing that
 * needed them. The dashboard has its own reader for the same processor in
 * `src/lib/whop.ts`, and on 2026-09-04 the two turned out to disagree about
 * something that mattered: this one kept `refunded` per buyer — its own comment
 * says why, "never paid and paid and was refunded are different facts about a
 * call" — and the dashboard's netted it off and threw it away. A customer who
 * paid $2,000 and was refunded $1,667 therefore reached a chase list as
 * somebody owing $1,667.
 *
 * One reader cannot answer two ways. So anything in `scripts/` that reads these
 * systems reads them from here, and `tests/live-read-agrees.test.ts` holds this
 * file and the dashboard's reader to the same answer on the same payment.
 *
 * Nothing here interprets. No sale rule, no matching, no judgement about what a
 * payment means — those live in sales-rules.json, buyer-match.mjs and the
 * dashboard's own libraries. This file fetches and shapes, and that is all.
 */
import { NOTION_VERSION } from "./notion-env.mjs";

const WHOP_V2 = process.env.WHOP_API_V2_BASE ?? "https://api.whop.com/api/v2";

/** Thrown when a system refuses, so a caller can report rather than crash. */
export class LiveReadError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

/**
 * Every row on the call tracker.
 *
 * `cash` falls back to Collected On Call because a row where nobody has typed
 * Cash Collected has still banked whatever was taken on the call; `onCall` is
 * kept apart because it is written by the workflow from the recording, so it is
 * a claim about money taken DURING the call rather than a figure a person
 * reconciled afterwards.
 */
export async function readTracker({ notionKey, databaseId }) {
  const rows = [];
  let cursor;

  for (;;) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      throw new LiveReadError(
        `Notion refused the tracker (${res.status}).`,
        res.status === 401
          ? "The token is invalid or was rotated. Note that the n8n workflow holds " +
            "its OWN copy of this token — fixing one does not fix the other."
          : detail.slice(0, 200)
      );
    }

    const page = await res.json();
    for (const row of page.results ?? []) {
      const p = row.properties;
      rows.push({
        id: row.id,
        name: (p.Name?.title ?? []).map((t) => t.plain_text ?? "").join(""),
        email: (p["Prospect Email"]?.email ?? "").trim().toLowerCase() || null,
        date: p["Call Date"]?.date?.start ?? null,
        closer: p.Closer?.select?.name ?? null,
        outcome: p.Outcome?.select?.name ?? null,
        priceClosed: p["Price Closed"]?.number ?? null,
        cash: p["Cash Collected"]?.number ?? p["Collected On Call"]?.number ?? 0,
        onCall: p["Collected On Call"]?.number ?? 0,
        url: `https://www.notion.so/${row.id.replace(/-/g, "")}`,
      });
    }

    if (!page.has_more) break;
    cursor = page.next_cursor;
  }

  return rows;
}

/**
 * One Whop payment reduced to the fields anything here reads.
 *
 * Exported on its own because it is the half that can be tested without a
 * network: the dashboard's `normalizeWhopPayment` must agree with it field for
 * field, and a test says so.
 *
 * v2 calls the gross `final_amount`; v1 called it `total`. Both are accepted so
 * a rename cannot silently zero the money. Timestamps are Unix seconds.
 */
export function readPayment(p) {
  const user = p.user && typeof p.user === "object" ? p.user : {};
  const email = (user.email ?? "").trim().toLowerCase();
  const gross = [p.final_amount, p.total, p.subtotal].find((v) => typeof v === "number") ?? 0;
  const refunded = p.refunded_amount ?? 0;
  const stamp = p.paid_at ?? p.created_at;

  return {
    email: email || null,
    // What stayed collected: gross less anything given back.
    net: Math.max(0, gross - refunded),
    gross,
    // NEVER JUST NETTED OFF. "Never paid" and "paid and was refunded" are
    // different facts about a call, and only one of them is money somebody can
    // still be asked for. See the header.
    refunded,
    day: typeof stamp === "number" ? new Date(stamp * 1000).toISOString().slice(0, 10) : null,
    /* THE BILLING NAME, NOT THE DISPLAY NAME. `user.name` is a Whop handle —
       "stonyartisan82", "jackdadawg" — which matches nothing on a call row. The
       billing name is the person, and it rides on every payment. */
    billing: [p.billing_first_name, p.billing_last_name].filter(Boolean).join(" "),
    handle: user.name || user.username || "",
    /** Whop's own label. `subscription_cycle` is a renewal: cash, not a sale. */
    reason: p.billing_reason ? String(p.billing_reason).toLowerCase().trim() : null,
    /** Which offer the money was for. Two products on one account is normal. */
    product: typeof p.product === "object" ? p.product?.id ?? null : p.product ?? null,
  };
}

/**
 * Every paid payment, aggregated per buyer.
 *
 * `history` keeps each payment's day and amount rather than only the total,
 * because "how much arrived ON the call" cannot be answered from a running sum.
 */
export async function readPayments({ whopKey, maxPages = 200 }) {
  const buyers = new Map();

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(`${WHOP_V2}/payments`);
    for (const [k, v] of Object.entries({ per: 50, page, status: "paid", "expand[]": "user" })) {
      url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${whopKey}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new LiveReadError(
        `Whop refused the payments route (${res.status}).`,
        "Check in this order: is this still the v2 endpoint, and does the key " +
          `have payment:basic:read. (${detail.slice(0, 160)})`
      );
    }

    const body = await res.json();
    const payments = Array.isArray(body) ? body : (body.data ?? []);
    if (payments.length === 0) break;

    for (const raw of payments) {
      const p = readPayment(raw);
      if (!p.email) continue;

      const buyer = buyers.get(p.email) ?? {
        email: p.email,
        name: p.handle,
        billing: "",
        paid: 0,
        refunded: 0,
        gross: 0,
        payments: 0,
        first: p.day,
        last: p.day,
        products: new Set(),
        history: [],
      };
      if (p.billing && !buyer.billing) buyer.billing = p.billing;
      buyer.paid += p.net;
      buyer.refunded += p.refunded;
      buyer.gross += p.gross;
      buyer.payments += 1;
      buyer.history.push({ day: p.day, amount: p.net, reason: p.reason, product: p.product });
      if (p.product) buyer.products.add(p.product);
      if (p.day && (!buyer.first || p.day < buyer.first)) buyer.first = p.day;
      if (p.day && (!buyer.last || p.day > buyer.last)) buyer.last = p.day;
      buyers.set(p.email, buyer);
    }

    const totalPages = body?.pagination?.total_page ?? 1;
    if (page >= totalPages) break;
  }

  return buyers;
}
