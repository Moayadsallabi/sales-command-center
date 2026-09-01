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
import { loadEnv, NOTION_VERSION } from "./lib/notion-env.mjs";
// ONE MATCHER, SHARED WITH THE DASHBOARD. It used to be a second copy here and
// the two drifted apart on live data; `scripts/lib/buyer-match.mjs` opens with
// what each divergence cost.
import {
  matchBuyers,
  buyerHaystacks,
  nameScore,
  corroborationOf,
  corroborationLabel,
  CORROBORATION,
  CORROBORATION_ORDER,
  CASH_TOLERANCE,
} from "./lib/buyer-match.mjs";

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
const WHOP_V2 = process.env.WHOP_API_V2_BASE ?? "https://api.whop.com/api/v2";

/**
 * WHERE THIS CHECK STOPS LOOKING BACK.
 *
 * Read from sales-rules.json rather than typed here, because the KPI dashboard
 * has to obey the same date and the two copies are compared by check:rules.
 *
 * A row older than this is not reconciled and not reported. The tracking was
 * built around 2026-08-16: the inbox sync began recording conversations on the
 * 16th and the booking form started asking for the Instagram handle on the
 * 18th, so a gap on an older row measures the absence of the system rather than
 * anything anybody did. [STATED - Moayad, chat 2026-08-24: "no matter what we
 * do that data from previous to that is tainted"]
 *
 * This is NOT a floor on the dashboard - revenue and the close rate still count
 * the full history, because that money was really earned. It governs what this
 * report puts in front of a person, so the lists stay actionable.
 *
 * How many rows it dropped is printed on every run. A cutoff nobody can see is
 * indistinguishable from a tracker that has gone quiet.
 */
/**
 * CALLS RULED OUT AS ANOTHER OFFER'S BUSINESS.
 *
 * This script was reporting them anyway. The 2026-08-22 "Unknown" row was ruled
 * out on 2026-08-24 as Tpan's own offer, and the very next run still put it top
 * of the must-fix list — so a ruling that had been made was going to be asked
 * for again every week, which is how a report teaches people to skim it.
 *
 * Same rules as src/lib/excluded-calls.ts: the page id wins when the entry has
 * one, date plus name is the fallback, and both halves of the fallback must
 * match. A .mjs script cannot import the TypeScript library, so this is a
 * deliberate second copy - keep the two in step.
 */
function loadExclusions() {
  try {
    const parsed = JSON.parse(readFileSync("excluded-calls.json", "utf8"));
    return Object.entries(parsed)
      .filter(([key]) => !key.startsWith("_"))
      .flatMap(([, list]) => (Array.isArray(list) ? list : []));
  } catch {
    return [];
  }
}

const pageId = (v) => String(v ?? "").trim().toLowerCase().replace(/-/g, "");
const lower = (v) => String(v ?? "").trim().toLowerCase();

function excludedBy(row, entries) {
  for (const entry of entries) {
    if (entry.notion_page_id) {
      if (pageId(entry.notion_page_id) === pageId(row.id)) return entry;
      continue;
    }
    const date = String(row.date ?? "").slice(0, 10);
    if (!date || !lower(row.name)) continue;
    if (String(entry.call_date ?? "").slice(0, 10) === date && lower(entry.prospect_name) === lower(row.name)) {
      return entry;
    }
  }
  return null;
}

const DATA_STARTS = (() => {
  try {
    return JSON.parse(readFileSync("sales-rules.json", "utf8")).data_starts?.date ?? null;
  } catch {
    return null;
  }
})();


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
        "Notion-Version": NOTION_VERSION,
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
        // EVERY PAYMENT'S DAY AND AMOUNT, not just the total. The cash check
        // below has to ask "how much arrived ON the call", and a running total
        // cannot answer that — see the note on cashOff.
        history: [],
      };
      if (billing && !buyer.billing) buyer.billing = billing;
      buyer.paid += net;
      buyer.refunded += p.refunded_amount ?? 0;
      buyer.gross += gross;
      buyer.payments += 1;
      buyer.history.push({ day, amount: net });
      if (day && (!buyer.first || day < buyer.first)) buyer.first = day;
      buyers.set(email, buyer);
    }

    const totalPages = body?.pagination?.total_page ?? 1;
    if (page >= totalPages) break;
  }

  return buyers;
}

/* ----------------------------------------------------------------- matching */

/*
 * Nothing is implemented here any more. `scripts/lib/buyer-match.mjs` holds the
 * whole rule — the email join, the name fallback, the two-signal floor, the tie
 * refusal and the best-first assignment — and `src/lib/reconcile.ts` imports
 * that same file, so the report and the page cannot answer differently again.
 */

const allTracker = await readTracker();
const buyers = await readPayments();
const exclusions = loadExclusions();
const ruledOut = allTracker.filter((r) => excludedBy(r, exclusions));

/*
 * AN OLD CALL WHOSE MONEY IS STILL MOVING IS NOT AN OLD CALL.
 *
 * The cutoff drops calls from before the tracking existed, because a gap on
 * one of those measures the absence of the system. But a row from 10 August
 * whose buyer paid again on the 22nd is live work: Danny's row still read
 * "$300 collected, $3,700 due" on 2026-08-24, having been reconciled on the
 * 18th and overtaken by an $800 payment on the 22nd. Dropping him by call date
 * alone meant nothing would ever notice again.
 *
 * So a pre-cutoff row is kept when its buyer has paid on or since the cutoff.
 * Matched on the row's own email — a guess by name is not enough to reopen a
 * row the cutoff has already set aside.
 */
const paidSinceCutoff = new Set(
  [...buyers.values()]
    .filter((b) => b.history.some((h) => h.day && DATA_STARTS && h.day >= DATA_STARTS))
    .map((b) => b.email)
);
const beforeCutoff = allTracker.filter(
  (r) =>
    !ruledOut.includes(r) &&
    DATA_STARTS &&
    r.date &&
    String(r.date).slice(0, 10) < DATA_STARTS &&
    !(r.email && paidSinceCutoff.has(String(r.email).trim().toLowerCase()))
);
const dropped = new Set([...ruledOut, ...beforeCutoff]);
const tracker = allTracker.filter((r) => !dropped.has(r));

console.log(
  `Tracker: ${tracker.length} rows (${tracker.filter((r) => r.email).length} with a prospect email)`
);
// Named, not silent: excluded-calls.json's own README requires every command
// that reads it to say how many rows it left out, so the list cannot rot.
if (ruledOut.length) {
  console.log(`         ${ruledOut.length} row(s) ruled out as another offer's business:`);
  for (const r of ruledOut) {
    console.log(`           ${r.date ?? "no date"}  ${r.name} — ${excludedBy(r, exclusions).ruled_by}`);
  }
}
if (beforeCutoff.length) {
  console.log(
    `         ${beforeCutoff.length} row(s) before ${DATA_STARTS} left out — the tracking was not built yet, ` +
      `so a gap on them says nothing. Change data_starts in sales-rules.json to look further back.`
  );
}
const banked = [...buyers.values()].reduce((sum, b) => sum + b.paid, 0);
console.log(`Whop:    ${buyers.size} buyers, ${money(banked)} collected\n`);

const haystacks = buyerHaystacks(buyers.values());

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
 * The same rule, for the same reason, is in src/lib/reconcile.ts — which now
 * imports the very same matcher this file does, so "kept in step" is a fact
 * about the module graph rather than a promise in a comment.
 */
const considered = tracker.filter((row) => row.outcome !== "No show");

const matches = matchBuyers(considered, buyers.values(), {
  emailOf: (row) => row.email,
  nameOf: (row) => row.name,
});
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
    /*
     * A TO-DATE FIGURE AGAINST THE TOTAL RECEIVED, which is the right pairing.
     *
     * `cash` reads Cash Collected — the figure a person reconciled after the
     * call — and falls back to Collected On Call only when nobody has written
     * one. Both halves therefore mean "money received by now", so the buyer's
     * total is the correct yardstick.
     *
     * Tried and reverted on 2026-08-24: comparing it against payments made ON
     * the call day. That is the right test for Collected On Call, which is a
     * claim about the call itself — and `unbanked` above already applies it.
     * Applied to Cash Collected it inverted the check, reporting every deal
     * paid after its call as a contradiction.
     *
     * WHEN the money arrived is still worth saying, so the report prints the
     * last payment date beside the gap: "$300 recorded, $1,100 received, last
     * on 22 Aug" is a stale row, and it reads as one.
     */
    const lastPaid = match.buyer.history
      .map((h) => h.day)
      .filter(Boolean)
      .sort()
      .at(-1);
    if (Math.abs(row.cash - match.buyer.paid) >= CASH_TOLERANCE) {
      cashOff.push({ row, ...match, lastPaid });
    }
  }
}

const byDate = (a, b) => String(a.row?.date ?? a.date).localeCompare(String(b.row?.date ?? b.date));
missedCloses.sort(byDate);
cashOff.sort(byDate);
belowBar.sort(byDate);
unbanked.sort(byDate);
deposits.sort(byDate);
noPayment.sort(byDate);

/* ------------------------------------- a close that is already on the tracker

THE SHAPE, from Brey's live account on 2026-08-21.

X'Zadrea Strickland was called on 27 July, did not buy, and the row says BAMFAM.
She was called again on 20 August under her Whop handle, "Lucid Cookie", and
that row says Customer. Her $2,000 arrived on 20 August.

Only the July row carries her email address, so the payment matched there, and
this script reported the July call as a close that had been missed. Applying
that would have turned a call that genuinely did not close into a close, and
credited the same $2,000 twice — two sales, one deal, and a close rate built on
it.

So before a row is offered for promotion, look for a LATER call, already marked
Customer, whose name fits the same buyer. If there is one, the money belongs to
that call and the correction is on that row instead: it is the one missing the
email address, and until it has one every future run will make this same wrong
suggestion.

Scored with the same rule the matcher uses. These rows lost the buyer to an
email match rather than to a better name — that is the only reason they are
unmatched — so asking the name question again is asking who they are, not
inventing a second matcher.
*/
const buyerText = new Map(haystacks.map((h) => [h.buyer.email, h.text]));

function laterCloseFor(m) {
  const text = buyerText.get(m.buyer.email) ?? "";
  const after = String(m.row.date ?? "");
  return (
    considered.find(
      (other) =>
        other !== m.row &&
        other.outcome === "Customer" &&
        // A row with its own matched buyer is a different person's call.
        !matches.has(other) &&
        String(other.date ?? "") >= after &&
        nameScore(other.name, text) >= 2
    ) ?? null
  );
}

const duplicated = [];
for (let i = missedCloses.length - 1; i >= 0; i--) {
  const later = laterCloseFor(missedCloses[i]);
  if (!later) continue;
  duplicated.push({ ...missedCloses[i], later });
  missedCloses.splice(i, 1);
}
duplicated.sort(byDate);

// The later row is explained in full by the section above, so leave it out of
// the unmatched-customer list rather than saying the same thing twice.
const explained = new Set(duplicated.map((d) => d.later));
for (let i = noPayment.length - 1; i >= 0; i--) if (explained.has(noPayment[i])) noPayment.splice(i, 1);

/*
 * SCOPED TO THE SAME CUTOFF AS THE TRACKER, and it has to be.
 *
 * This asks "who paid with no call on the tracker". Cutting the tracker to rows
 * since 2026-08-16 without cutting the buyers turned that into "who paid, ever,
 * with no RECENT call" — it jumped from 69 buyers to 102 the moment the cutoff
 * went in, and every one of the extra 33 has a call, just an older one. A
 * number that moves like that on a change to the other side of the comparison
 * was measuring the comparison, not the coverage.
 *
 * Counted on the buyer's FIRST payment, which is the closest thing here to when
 * they arrived.
 */
const untracked = [...buyers.values()]
  .filter((b) => !claimed.has(b.email))
  .filter((b) => !DATA_STARTS || !b.first || String(b.first).slice(0, 10) >= DATA_STARTS)
  .sort((a, b) => b.paid - a.paid);

/* ------------------------------------------------------------------- report */

/*
 * HOW MUCH THE NAME MATCH IS WORTH, not just that there was one.
 *
 * Every non-email match used to carry the same flat "[matched on name, check
 * before editing]", so the row resting on nothing but a first name looked
 * exactly like the one whose deal price agrees to the dollar with what the
 * buyer banked. A warning that fires on everything gets read as decoration.
 * The deal price is independent of both the matcher and the cash test, so it
 * is a real second opinion where it exists. See buyer-match.mjs.
 */
const grade = (m) => corroborationOf(m.certain, m.row.priceClosed, m.buyer.paid);
const guess = (m) => {
  const label = corroborationLabel(grade(m));
  return label ? `  [${label}]` : "";
};

/** Weakest evidence first — the order these are worth working in. */
const byConfidence = (a, b) => {
  const rank = CORROBORATION_ORDER.indexOf(grade(a)) - CORROBORATION_ORDER.indexOf(grade(b));
  return rank !== 0 ? rank : String(a.row.date ?? "").localeCompare(String(b.row.date ?? ""));
};
missedCloses.sort(byConfidence);
cashOff.sort(byConfidence);

/** How many rows in a list have no second source behind them at all. */
const unpricedIn = (list) => list.filter((m) => grade(m) === CORROBORATION.unpriced).length;

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
} else if (!duplicated.length) {
  console.log("✓ Every prospect who paid is marked Customer\n");
}

if (duplicated.length) {
  console.log(
    `✗ ${duplicated.length} payment${duplicated.length === 1 ? " is" : "s are"} already closed on a later call — ` +
      `the earlier call must NOT be promoted, or the same deal counts twice:\n`
  );
  for (const d of duplicated) {
    console.log(
      `  ${d.row.date ?? "no date"}  ${d.row.name.padEnd(22)} ${String(d.row.outcome).padEnd(14)}` +
        ` — leave as is, ${money(d.buyer.paid)} arrived ${d.buyer.first ?? "later"}`
    );
    console.log(`      ${d.row.url}`);
    console.log(
      `  ${d.later.date ?? "no date"}  ${d.later.name.padEnd(22)} ${String(d.later.outcome).padEnd(14)}` +
        ` — this is the close. Put ${d.buyer.email} and ${money(d.buyer.paid)} on THIS row`
    );
    console.log(`      ${d.later.url}`);
  }
  console.log(
    "\n  Both rows are the same person. Only the earlier one carries the email\n" +
      "  address, which is why the payment landed there. Adding the address to the\n" +
      "  later row is what stops this coming back every run.\n"
  );
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
  const bare = unpricedIn(cashOff);
  console.log(
    `⚠ ${cashOff.length} customer row${cashOff.length === 1 ? " disagrees" : "s disagree"} with Whop on cash` +
      // Named because it is the only part of this list a person has to judge:
      // the rest carry a deal price that already agrees with the payment.
      (bare
        ? `, ${bare} of them resting on the name alone — those are listed first:\n`
        : ":\n")
  );
  for (const m of cashOff) {
    // "Whop $4,000" used to mean the buyer's lifetime total, beside a figure
    // that means one call. Both halves now cover the same day, and money that
    // arrived afterwards is named as what it is rather than folded in.
    // The date is the tell for a stale row: money that arrived after the row
    // was last reconciled is the usual reason these two numbers differ.
    const when = m.lastPaid ? `  (last payment ${m.lastPaid})` : "";
    console.log(
      `  ${m.row.date ?? "no date"}  ${m.row.name.padEnd(22)} tracker ${money(m.row.cash).padEnd(9)}` +
        ` Whop ${money(m.buyer.paid)}${when}${guess(m)}`
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
      "Notion-Version": NOTION_VERSION,
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
    // The total received, into the to-date column. Collected On Call is never
    // touched here: that one is the workflow's claim about the call itself and
    // a reconciliation must not overwrite it.
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
  if (duplicated.length) {
    console.log(
      `\n${duplicated.length} row${duplicated.length === 1 ? " was" : "s were"} deliberately NOT promoted — ` +
        "the money is already a close on a later call. See the list above; those are edits only a person should make."
    );
    process.exit(1);
  }
  process.exit(0);
}

// These are things a person can fix by editing a row. The rest — the deposits,
// the unmatched customers, the untracked buyers — are context, and failing on
// them would make this un-runnable rather than useful.
//
// READ BY weekly-checks.mjs: the choice of closing sentence is how the Slack
// report knows whether to offer `--apply` at all. Offering it when the only
// finding is one --apply deliberately refuses to write sends somebody to run a
// command that does nothing. Change the wording here and change it there.
if (missedCloses.length || cashOff.length || belowBar.length || duplicated.length) {
  console.log(
    applying || !(missedCloses.length || cashOff.length)
      ? "Fix the rows above in Notion, then rerun this."
      : "Rerun with `npm run check:payments -- --apply` to write these corrections into Notion."
  );
  process.exit(1);
}
console.log("Tracker and payments agree on every row that can be matched.");
