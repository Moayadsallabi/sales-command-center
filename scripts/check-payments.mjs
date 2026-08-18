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
/**
 * What a deposit has to reach before the call counts as a sale.
 *
 * [STATED — Moayad, 2026-08-18] "even if a deposit doesnt pay the rest, its
 * still technically a close unless its under $100 i think then that we
 * shouldnt count as a close." A flat floor, not a share of the deal: a closer
 * who banks a real deposit has closed, whether or not the balance ever
 * arrives. This replaced a 25% bar, which had the perverse effect of making
 * the same $500 deposit a sale on a $2,000 deal and not one on a $4,000 deal.
 *
 * Set to 0 to switch this check off.
 */
const MIN_DEPOSIT = 100;
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
        id: row.id,
        name: (p.Name?.title ?? []).map((t) => t.plain_text ?? "").join(""),
        email: (p["Prospect Email"]?.email ?? "").trim().toLowerCase() || null,
        date: p["Call Date"]?.date?.start ?? null,
        closer: p.Closer?.select?.name ?? null,
        outcome: p.Outcome?.select?.name ?? null,
        priceClosed: p["Price Closed"]?.number ?? null,
        cash: p["Cash Collected"]?.number ?? p["Collected On Call"]?.number ?? 0,
        // Kept apart from `cash` on purpose. This one is written by the
        // workflow from what happened on the recording, so it is a claim about
        // money taken during the call — not a figure a human reconciled after.
        onCall: p["Collected On Call"]?.number ?? 0,
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

      // Two names come back and they are not equally useful. `user.name` is the
      // Whop display name and is usually a handle — "stonyartisan82",
      // "jackdadawg", "CeeLo Tunes" — which matches nothing on a call row. The
      // billing name is the real person ("Luke Mcdougall", "Nicole Olvera",
      // "Carlos Lassalle") and is present on every payment. Matching on the
      // handle alone is why rows carrying a perfectly good name still came back
      // unmatched, and it is the single cheapest fix to coverage here.
      const billing = [p.billing_first_name, p.billing_last_name].filter(Boolean).join(" ");
      const buyer = buyers.get(email) ?? {
        email,
        name: user.name || user.username || "",
        billing: "",
        paid: 0,
        // Money that went back out. Kept rather than just netted off, because
        // "never paid" and "paid and was refunded" are different facts about a
        // call and want different rows on the tracker.
        refunded: 0,
        gross: 0,
        payments: 0,
        first: day,
      };
      if (billing && !buyer.billing) buyer.billing = billing;
      buyer.paid += net;
      buyer.refunded += p.refunded_amount ?? 0;
      buyer.gross += gross;
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
    // Two signals, never one. A single shared word off a two-word name is not
    // a weak match, it is a different person: "Barron ace" scored a hit on
    // "Ace Acosta" and reported his $4,000 against Barron's call, and "Jon
    // gonzalez" took Robinson Gonzalez's $562. Both were the only candidate, so
    // nothing else caught them. A one-word row name is unaffected — the whole
    // name is then the token, so a genuine hit scores two on its own.
    .filter((c) => c.score >= 2)
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
  text: normalise(`${buyer.billing} ${buyer.name} ${buyer.email.split("@")[0]}`),
}));

/**
 * A NO-SHOW THAT LATER PAID IS NOT A CALL THAT HAPPENED.
 *
 * [sales-rules.json] "A payment proves a SALE. It does not prove that a CALL
 * HAPPENED." This script can WRITE its corrections back into Notion with
 * --apply, so promoting a no-show here does not just misreport a close rate
 * for one render — it edits the client's tracker, and the row then reads as a
 * held call to everyone and everything downstream for good.
 *
 * Dropped BEFORE matching, so their buyer stays unclaimed and lands in the
 * untracked list — the money is still reported, as a payment no call explains.
 * It also frees a buyer who no-showed once and then turned up to match the
 * call they actually attended.
 *
 * The same rule, for the same reason, is in src/lib/reconcile.ts. These two
 * matchers are deliberately kept in step; a test covers the library side.
 */
const considered = tracker.filter((row) => row.outcome !== "No show");

const matches = matchAll(considered, buyers, haystacks);
const claimed = new Set([...matches.values()].map((m) => m.buyer.email));

const missedCloses = [];
const cashOff = [];
const noPayment = [];
const belowBar = [];
/**
 * Money the closer recorded taking on the call that Whop has never seen.
 *
 * `Collected On Call` is written at scoring time from what was said on the
 * recording, and a payment link sent is not a payment made. Nothing goes back
 * afterwards to ask whether it landed, so the claim sits on the row looking
 * exactly like cash. Checked for every outcome, because a deposit on an open
 * call is claimed the same way a sale is.
 */
const unbanked = [];
/** Money banked against a call that is correctly still open. Not a problem. */
const deposits = [];

for (const row of tracker) {
  const match = matches.get(row);

  // Runs over EVERY row, no-shows included: a claim of money taken on a call
  // nobody attended is exactly the kind of thing worth naming, and this check
  // is about the claim rather than about the outcome.
  if (row.onCall > 0 && (match?.buyer.paid ?? 0) + CASH_TOLERANCE < row.onCall) {
    unbanked.push({ row, ...(match ?? {}) });
  }

  // Everything below decides what a payment PROVES, and a no-show was held out
  // of matching above, so there is nothing here for it.
  if (row.outcome === "No show") continue;

  if (!match) {
    if (row.outcome === "Customer") noPayment.push(row);
    continue;
  }

  if (row.outcome !== "Customer" && row.outcome !== "REFUND") {
    // Money on a non-customer row is only a missed close if it has reached the
    // bar. Below it, a deposit against an open follow-up is the correct state,
    // not a mistake — flagging those would tell someone to file a $25 deposit
    // as a $2,000 sale, which is exactly what this threshold exists to stop.
    // With no deal value on the row there is no percentage to take, so the bar
    // cannot be applied either way. That is the normal state for an open call —
    // the scorer only records a closed price when the call closed — so it
    // belongs with the deposits, not asserted as a missed sale.
    if (MIN_DEPOSIT > 0 && match.buyer.paid < MIN_DEPOSIT) deposits.push({ row, ...match });
    else missedCloses.push({ row, ...match });
  } else if (row.outcome === "Customer") {
    // A customer whose deal value is recorded but whose payments have not
    // reached the bar is a deposit filed as a sale.
    if (MIN_DEPOSIT > 0 && match.buyer.paid > 0 && match.buyer.paid < MIN_DEPOSIT) {
      belowBar.push({ row, ...match });
    }
    if (Math.abs(row.cash - match.buyer.paid) >= CASH_TOLERANCE) cashOff.push({ row, ...match });
  }
}

const byDate = (a, b) => String(a.row?.date ?? a.date).localeCompare(String(b.row?.date ?? b.date));
missedCloses.sort(byDate);
cashOff.sort(byDate);
belowBar.sort(byDate);
unbanked.sort(byDate);
deposits.sort(byDate);
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

if (belowBar.length) {
  console.log(
    `✗ ${belowBar.length} row${belowBar.length === 1 ? "" : "s"} marked Customer on a deposit under ` +
      `${money(MIN_DEPOSIT)} — a token filed as a sale:\n`
  );
  for (const m of belowBar) {
    console.log(
      `  ${m.row.date ?? "no date"}  ${m.row.name.padEnd(22)} deal ${money(m.row.priceClosed)}, ` +
        `banked ${money(m.buyer.paid)}${guess(m)}`
    );
    console.log(`      ${m.row.url}`);
  }
  console.log();
}

if (unbanked.length) {
  const claimedTotal = unbanked.reduce((sum, m) => sum + m.row.onCall, 0);
  console.log(
    `✗ ${unbanked.length} row${unbanked.length === 1 ? " records" : "s record"} money taken on the call ` +
      `that Whop does not hold — ${money(claimedTotal)} claimed:\n`
  );
  for (const m of unbanked) {
    const held = m.buyer ? money(m.buyer.paid) : "nothing";
    console.log(
      `  ${m.row.date ?? "no date"}  ${m.row.name.padEnd(22)} row says ${money(m.row.onCall).padEnd(8)} ` +
        `Whop holds ${held}${m.row.email ? "" : "  [no prospect email on the row]"}${m.buyer ? guess(m) : ""}`
    );
    console.log(`      ${m.row.url}`);
  }
  console.log(
    "\n  A card entered as the call ended is the usual cause, and it either cleared\n" +
      "  later or it never did. Check the ones more than a day old first.\n"
  );
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
  // This list is the weakest thing in this report and must stay labelled as
  // such. "No payment found" is not "did not pay": a row with no prospect email
  // falls back to matching on name, and that fallback is deliberately strict —
  // it misses real buyers whose Whop display name looks nothing like the name on
  // the row. Two known cases matched by eye and not by this code. Treat a row
  // here as unverified, never as unpaid.
  const unmatchable = noPayment.filter((r) => !r.email).length;
  console.log(
    `⚠ ${noPayment.length} row${noPayment.length === 1 ? "" : "s"} marked Customer that could ` +
      `not be matched to a payment. ${unmatchable} of them carry no prospect email, so nothing ` +
      `could have matched them. THIS IS NOT EVIDENCE THEY DID NOT PAY — it is the list to go\n` +
      `  and check by hand, and the reason to get emails onto the calendar invites:\n`
  );
  for (const row of noPayment) {
    console.log(
      `  ${row.date ?? "no date"}  ${row.name.padEnd(22)} closed ${money(row.priceClosed ?? 0)}` +
        `${row.email ? "" : "  [no prospect email on the row]"}`
    );
  }
  console.log();
}

if (deposits.length) {
  const held = deposits.reduce((sum, m) => sum + m.buyer.paid, 0);
  console.log(
    `· ${deposits.length} open call${deposits.length === 1 ? " has" : "s have"} taken a deposit ` +
      `under ${money(MIN_DEPOSIT)} — ${money(held)} banked, correctly not ` +
      `counted as sales:\n`
  );
  for (const m of deposits) {
    const of = m.row.priceClosed > 0 ? ` of ${money(m.row.priceClosed)}` : "";
    console.log(`  ${m.row.date ?? "no date"}  ${m.row.name.padEnd(22)} ${money(m.buyer.paid)}${of}  ${m.row.outcome}`);
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
    console.log(`  ${b.first ?? "?"}  ${(b.billing || b.name || b.email).padEnd(28)} ${money(b.paid)}`);
  }
  if (untracked.length > 10) console.log(`  … and ${untracked.length - 10} more`);
  console.log();
}

/* ------------------------------------------------------------------ refunds */

// [STATED — Moayad, 2026-08-18] "If a refund is done we remove it from cash."
// A refund is not a smaller payment, it is a reversed one, so a row whose money
// came back should say REFUND rather than sit as a customer with a shrinking
// cash figure. The dashboard already keeps REFUND rows out of both cash and
// revenue; what was missing was anything to notice one had happened. Vellatino
// Crawford paid $2,000, had all of it returned, and read as a customer who had
// simply never paid.
const refunded = [];
for (const [row, match] of matches) {
  const back = match.buyer.refunded ?? 0;
  if (back <= 0) continue;
  const whole = (match.buyer.paid ?? 0) === 0;
  if (row.outcome === "REFUND" && whole) continue;
  refunded.push({ row, buyer: match.buyer, back, whole });
}

if (refunded.length > 0) {
  const full = refunded.filter((r) => r.whole);
  console.log(
    `↩ ${refunded.length} row${refunded.length === 1 ? "" : "s"} had money refunded` +
      `${full.length ? `, ${full.length} of them in full` : ""}:\n`
  );
  for (const r of refunded) {
    console.log(
      `  ${(r.row.date ?? "?").slice(0, 10)}  ${r.row.name.padEnd(22)} ` +
        `${money(r.buyer.gross ?? 0)} in, ${money(r.back)} back` +
        `${r.whole ? "  — mark this REFUND" : `, ${money(r.buyer.paid)} kept`}` +
        `${r.row.outcome === "REFUND" ? "" : `  [row says ${r.row.outcome ?? "nothing"}]`}`
    );
    console.log(`      ${r.row.url}`);
  }
  console.log();
}

/* -------------------------------------------------------------------- apply */

// `--apply` writes the corrections above straight into Notion instead of
// leaving them as homework: a matched row gets the processor's cash figure,
// the buyer's email if the row has none, and — where money arrived on a row
// not marked Customer — the Customer outcome. Ruled by Moayad 2026-08-18:
// when the system already knows the answer, typing it by hand is busywork.
// Name-matched writes are still guesses; every write is printed with its row
// link, and Notion's page history is the undo.
const applying = process.argv.includes("--apply");

async function patchRow(row, properties, described) {
  const res = await fetch(`https://api.notion.com/v1/pages/${row.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error(`  ✗ ${row.name}: Notion refused the edit (${res.status}) ${detail.slice(0, 120)}`);
    return false;
  }
  console.log(`  ✓ ${row.name.padEnd(22)} ${described}${row.email ? "" : "  [was matched on name]"}`);
  return true;
}

const emailOnly = [...matches.entries()].filter(
  ([row]) =>
    !row.email &&
    !missedCloses.some((x) => x.row === row) &&
    !cashOff.some((x) => x.row === row)
);

if (applying && (missedCloses.length || cashOff.length || emailOnly.length || refunded.length)) {
  console.log("\nApplying the corrections to Notion:\n");
  let written = 0;

  for (const m of missedCloses) {
    const properties = {
      Outcome: { select: { name: "Customer" } },
      "Cash Collected": { number: m.buyer.paid },
    };
    if (!m.row.email) properties["Prospect Email"] = { email: m.buyer.email };
    if (await patchRow(m.row, properties, `→ Customer, cash ${money(m.buyer.paid)}`)) written++;
    // Notion allows ~3 writes a second; pausing beats being throttled mid-run.
    await new Promise((r) => setTimeout(r, 350));
  }

  for (const m of cashOff) {
    const properties = { "Cash Collected": { number: m.buyer.paid } };
    if (!m.row.email) properties["Prospect Email"] = { email: m.buyer.email };
    if (await patchRow(m.row, properties, `cash ${money(m.row.cash)} → ${money(m.buyer.paid)}`)) written++;
    await new Promise((r) => setTimeout(r, 350));
  }

  // A row whose money all went back becomes a REFUND with its cash cleared.
  // Only a full refund: a partial one is a smaller payment, not a reversal, and
  // the cash correction above already handles it.
  for (const r of refunded.filter((x) => x.whole && x.row.outcome !== "REFUND")) {
    const properties = { Outcome: { select: { name: "REFUND" } }, "Cash Collected": { number: 0 } };
    if (await patchRow(r.row, properties, `→ REFUND, ${money(r.back)} returned`)) written++;
    await new Promise((res) => setTimeout(res, 350));
  }

  // Matched rows that needed no money correction still get their email filled
  // in, because email is the join that makes every future run certain instead
  // of a name-guess.
  for (const [row, m] of emailOnly) {
    if (await patchRow(row, { "Prospect Email": { email: m.buyer.email } }, `email ${m.buyer.email}`)) written++;
    await new Promise((r) => setTimeout(r, 350));
  }

  console.log(`\n${written} row${written === 1 ? "" : "s"} corrected. Rerun without --apply to verify.`);
  process.exit(0);
}

// These three are things a person can fix by editing a row. The rest — the
// deposits, the unmatched customers, the untracked buyers — are context, and
// failing on them would make this un-runnable rather than useful.
if (missedCloses.length || cashOff.length || belowBar.length) {
  console.log(
    applying
      ? "Fix the rows above in Notion, then rerun this."
      : "Rerun with `npm run check:payments -- --apply` to write these corrections into Notion."
  );
  process.exit(1);
}
console.log("Tracker and payments agree on every row that can be matched.");
