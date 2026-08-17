// Reconciles the call tracker against the money that actually arrived.
// Run with: npm run check:payments
//
// The tracker records what a call looked like at the moment it ended. Money
// does not respect that boundary: a prospect marked BAMFAM on Tuesday pays on
// Friday, and nothing goes back to change Tuesday's row. The dashboard then
// reports a close rate and a revenue figure built from the state of play on
// the day of the call, which is not the state of play now.
//
// Nothing can automate the correction — only a human knows whether a payment
// is the deal closing, a deposit on a follow-up, or a second instalment on a
// deal already counted. What this does is remove the searching: it names the
// rows where the payment processor and the tracker disagree, so the fixing is
// a short list rather than a reconciliation exercise.
//
// It reads Whop rather than the closers' sheets on purpose. A sheet is another
// hand-kept record and can be wrong in the same direction as the tracker; the
// processor is where the money actually moved.

import { readFileSync } from "node:fs";

/** Below this, a difference is fees or rounding rather than a mistake. */
const CASH_TOLERANCE = 50;
/** Short names collide. A fallback match needs a token at least this long. */
const MIN_NAME_TOKEN = 3;
/** Below this a token only counts as a whole word, never buried in another. */
const MIN_SUBSTRING_TOKEN = 5;
const WHOP_V2 = process.env.WHOP_API_V2_BASE ?? "https://api.whop.com/api/v2";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (!(match[1] in process.env)) process.env[match[1]] = value;
    }
  }
}

function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

const money = (n) => `$${Math.round(n).toLocaleString()}`;

loadEnv();

const notionKey = process.env.NOTION_API_KEY;
const databaseId = process.env.NOTION_DATABASE_ID;
const whopKey = process.env.WHOP_API_KEY;

if (!notionKey || !databaseId) {
  fail(
    "NOTION_API_KEY and NOTION_DATABASE_ID are both needed.",
    "They are in .env.local. Run `npm run check:notion` first if that fails."
  );
}
if (!whopKey) {
  fail(
    "WHOP_API_KEY is not set.",
    "Add this client's Whop key to .env.local. It needs the payment:basic:read " +
      "permission, from Whop's developer settings page."
  );
}

/* ------------------------------------------------------------- the tracker */

async function readTracker() {
  const rows = [];
  let cursor;

  for (;;) {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionKey}`,
        "Notion-Version": "2022-06-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const detail = await res.text();
      fail(
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
        name: (p.Name?.title ?? []).map((t) => t.plain_text ?? "").join(""),
        email: (p["Prospect Email"]?.email ?? "").trim().toLowerCase() || null,
        date: p["Call Date"]?.date?.start ?? null,
        closer: p.Closer?.select?.name ?? null,
        outcome: p.Outcome?.select?.name ?? null,
        priceClosed: p["Price Closed"]?.number ?? null,
        cash: p["Cash Collected"]?.number ?? p["Collected On Call"]?.number ?? 0,
        url: `https://www.notion.so/${row.id.replace(/-/g, "")}`,
      });
    }

    if (!page.has_more) break;
    cursor = page.next_cursor;
  }

  return rows;
}

/* ---------------------------------------------------------------- the money */

// v2, not v1: v1's payments route refuses a company API key outright whatever
// its permissions, which reads as a permission problem and is not one. The
// user expand is what carries the buyer's email, and email is the only join
// key the tracker and the processor share.
async function readPayments() {
  const buyers = new Map();

  for (let page = 1; page <= 200; page++) {
    const url = new URL(`${WHOP_V2}/payments`);
    for (const [k, v] of Object.entries({
      per: 50,
      page,
      status: "paid",
      "expand[]": "user",
    })) {
      url.searchParams.set(k, String(v));
    }

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${whopKey}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text();
      fail(
        `Whop refused the payments route (${res.status}).`,
        "Check in this order: is this still the v2 endpoint, and does the key " +
          `have payment:basic:read. (${detail.slice(0, 160)})`
      );
    }

    const body = await res.json();
    const payments = Array.isArray(body) ? body : (body.data ?? []);
    if (payments.length === 0) break;

    for (const p of payments) {
      const user = p.user && typeof p.user === "object" ? p.user : {};
      const email = (user.email ?? "").trim().toLowerCase();
      if (!email) continue;

      // What stayed collected: gross less anything refunded.
      const gross = [p.final_amount, p.total, p.subtotal].find((v) => typeof v === "number") ?? 0;
      const net = Math.max(0, gross - (p.refunded_amount ?? 0));
      const stamp = p.paid_at ?? p.created_at;
      const day = typeof stamp === "number" ? new Date(stamp * 1000).toISOString().slice(0, 10) : null;

      const buyer = buyers.get(email) ?? {
        email,
        name: user.name || user.username || "",
        paid: 0,
        payments: 0,
        first: day,
      };
      buyer.paid += net;
      buyer.payments += 1;
      if (day && (!buyer.first || day < buyer.first)) buyer.first = day;
      buyers.set(email, buyer);
    }

    const totalPages = body?.pagination?.total_page ?? 1;
    if (page >= totalPages) break;
  }

  return buyers;
}

/* ----------------------------------------------------------------- matching */

const normalise = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * A short name only counts as a whole word. Without that rule "Tee" matches
 * "steel" and the fallback starts inventing customers; with it, "Tee" still
 * finds "Tee Dory". Longer tokens are allowed to sit inside a word, because
 * that is how usernames are built — "beshensky" inside "bbeshensky".
 */
function tokenHits(tokens, text) {
  const padded = ` ${text} `;
  return tokens.filter((t) =>
    padded.includes(` ${t} `) || (t.length >= MIN_SUBSTRING_TOKEN && text.includes(t))
  ).length;
}

/**
 * Email is the only join anyone should trust, and most rows do not have one —
 * a prospect who was never a guest on the calendar invite leaves the column
 * blank. So there is a fallback on name, and everything it produces is
 * reported as a guess rather than a finding. A wrong guess here would send
 * someone to edit the wrong prospect's row, which is worse than a gap.
 *
 * Every candidate pair is scored before any of them is accepted, because
 * matching row by row lets whichever row happens to come first take a payment
 * that belongs to a better match further down: a row reading "Daniel" claims
 * Jeremy Daniel's payment, and the real Jeremy Daniel row is then reported as
 * a customer who never paid. Scoring first and assigning best-first means the
 * two-token match wins and the one-token match is left unmatched, which is the
 * honest answer.
 */
function scoreCandidates(row, buyers, haystacks) {
  if (row.email && buyers.has(row.email)) {
    return [{ buyer: buyers.get(row.email), score: Infinity, certain: true }];
  }

  const full = normalise(row.name);
  const tokens = full.split(/\s+/).filter((t) => t.length >= MIN_NAME_TOKEN);
  if (tokens.length === 0) return [];

  return haystacks
    .map(({ buyer, text }) => {
      const hits = tokenHits(tokens, text);
      // A buyer carrying the whole name outranks one sharing a single word.
      return { buyer, score: hits === 0 ? 0 : hits + (text.includes(full) ? 1 : 0), certain: false };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
}

/** Best-first assignment, skipping any row whose two best candidates tie. */
function matchAll(rows, buyers, haystacks) {
  const pairs = [];
  for (const row of rows) {
    const ranked = scoreCandidates(row, buyers, haystacks);
    if (ranked.length === 0) continue;
    // A tie means two different people fit equally well and nothing here can
    // tell them apart. Reporting a gap beats sending someone to the wrong row.
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) continue;
    pairs.push({ row, ...ranked[0] });
  }

  pairs.sort((a, b) => b.score - a.score);

  const byRow = new Map();
  const takenBuyers = new Set();
  for (const pair of pairs) {
    if (byRow.has(pair.row) || takenBuyers.has(pair.buyer.email)) continue;
    byRow.set(pair.row, pair);
    takenBuyers.add(pair.buyer.email);
  }
  return byRow;
}

/* ------------------------------------------------------------------ compare */

const tracker = await readTracker();
const buyers = await readPayments();

console.log(
  `Tracker: ${tracker.length} rows (${tracker.filter((r) => r.email).length} with a prospect email)`
);
const banked = [...buyers.values()].reduce((sum, b) => sum + b.paid, 0);
console.log(`Whop:    ${buyers.size} buyers, ${money(banked)} collected\n`);

const haystacks = [...buyers.values()].map((buyer) => ({
  buyer,
  text: normalise(`${buyer.name} ${buyer.email.split("@")[0]}`),
}));

const matches = matchAll(tracker, buyers, haystacks);
const claimed = new Set([...matches.values()].map((m) => m.buyer.email));

const missedCloses = [];
const cashOff = [];
const noPayment = [];

for (const row of tracker) {
  const match = matches.get(row);

  if (!match) {
    if (row.outcome === "Customer") noPayment.push(row);
    continue;
  }

  if (row.outcome !== "Customer" && row.outcome !== "REFUND") {
    missedCloses.push({ row, ...match });
  } else if (row.outcome === "Customer" && Math.abs(row.cash - match.buyer.paid) >= CASH_TOLERANCE) {
    cashOff.push({ row, ...match });
  }
}

const byDate = (a, b) => String(a.row?.date ?? a.date).localeCompare(String(b.row?.date ?? b.date));
missedCloses.sort(byDate);
cashOff.sort(byDate);
noPayment.sort(byDate);

const untracked = [...buyers.values()]
  .filter((b) => !claimed.has(b.email))
  .sort((a, b) => b.paid - a.paid);

/* ------------------------------------------------------------------- report */

const guess = (m) => (m.certain ? "" : "  [matched on name, check before editing]");

if (missedCloses.length) {
  const worth = missedCloses.reduce((sum, m) => sum + m.buyer.paid, 0);
  console.log(
    `✗ ${missedCloses.length} row${missedCloses.length === 1 ? "" : "s"} took money but ` +
      `${missedCloses.length === 1 ? "is" : "are"} not marked Customer — ${money(worth)} ` +
      `missing from Revenue and close rate:\n`
  );
  for (const m of missedCloses) {
    console.log(
      `  ${m.row.date ?? "no date"}  ${m.row.name.padEnd(22)} ${String(m.row.outcome).padEnd(14)}` +
        ` paid ${money(m.buyer.paid)}${m.buyer.payments > 1 ? ` over ${m.buyer.payments}` : ""}${guess(m)}`
    );
    console.log(`      ${m.row.url}`);
  }
  console.log();
} else {
  console.log("✓ Every prospect who paid is marked Customer\n");
}

if (cashOff.length) {
  console.log(`⚠ ${cashOff.length} customer row${cashOff.length === 1 ? "" : "s"} disagree with Whop on cash:\n`);
  for (const m of cashOff) {
    console.log(
      `  ${m.row.date ?? "no date"}  ${m.row.name.padEnd(22)} tracker ${money(m.row.cash).padEnd(9)}` +
        ` Whop ${money(m.buyer.paid)}${guess(m)}`
    );
    console.log(`      ${m.row.url}`);
  }
  console.log();
}

if (noPayment.length) {
  console.log(
    `⚠ ${noPayment.length} row${noPayment.length === 1 ? "" : "s"} marked Customer with no ` +
      `payment found. Some will be paid off-platform; a row with no prospect email cannot be ` +
      `matched at all, so this list is not evidence on its own:\n`
  );
  for (const row of noPayment) {
    console.log(
      `  ${row.date ?? "no date"}  ${row.name.padEnd(22)} closed ${money(row.priceClosed ?? 0)}` +
        `${row.email ? "" : "  [no prospect email on the row]"}`
    );
  }
  console.log();
}

if (untracked.length) {
  const worth = untracked.reduce((sum, b) => sum + b.paid, 0);
  console.log(
    `⚠ ${untracked.length} buyers paid ${money(worth)} with no call on the tracker at all.\n` +
      `  That is the coverage gap, not a data-entry gap — those calls either were never\n` +
      `  recorded, never reached the automation, or the customer never had a call.\n`
  );
  for (const b of untracked.slice(0, 10)) {
    console.log(`  ${b.first ?? "?"}  ${(b.name || b.email).padEnd(28)} ${money(b.paid)}`);
  }
  if (untracked.length > 10) console.log(`  … and ${untracked.length - 10} more`);
  console.log();
}

// Only the first two are things a person can fix by editing a row. The other
// two are context, and failing on them would make this un-runnable rather than
// useful.
if (missedCloses.length || cashOff.length) {
  console.log("Fix the rows above in Notion, then rerun this.");
  process.exit(1);
}
console.log("Tracker and payments agree on every row that can be matched.");
