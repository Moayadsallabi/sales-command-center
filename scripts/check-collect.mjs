/**
 * Checks the rows the collect list is about to put in front of a person.
 * Run with: npm run check:collect
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The Payments to collect panel is the only thing on the dashboard that names a
 * customer and asks somebody to ring them about money. Every other panel that
 * is wrong costs a wrong impression; this one costs a phone call to a person
 * who has already paid.
 *
 * It shipped on 2026-09-04 after an audit done by hand, and that audit found
 * two things the whole test suite was green through — a refunded customer
 * sitting on the list for the money he had been given back, and a third of the
 * rows resting on a match nothing had corroborated. Both were facts about the
 * DATA, not about the code, which is why no fixture contained them. The code
 * faults are fixed and unit-tested. This is the half a unit test cannot do:
 * read the live systems and say which rows a person should not act on yet.
 *
 * ---------------------------------------------------------------------------
 * IT REPORTS. IT NEVER CONCLUDES, AND IT WRITES NOTHING.
 *
 * Every finding here is a question for a person: is this two rows for one sale,
 * or two sales? Did this customer pay under another address, or not at all? A
 * script cannot answer those and should not pretend to — see check-payments.mjs,
 * which takes the same position about corrections it is far more certain of.
 *
 * WHAT MAKES IT EXIT NON-ZERO is deliberately narrow: only a refunded customer
 * reaching the list, because that one is a regression against a rule the code
 * now holds, and it is the failure that costs the phone call. Everything else
 * is reported and left. A check that fails every run on findings needing human
 * judgement is a check people learn to route around.
 */
import { readFileSync } from "node:fs";
import { loadEnv } from "./lib/notion-env.mjs";
import { readTracker, readPayments, LiveReadError } from "./lib/live-read.mjs";
import { matchBuyers, normalise } from "./lib/buyer-match.mjs";

/* THE OUTCOME LISTS COME FROM sales-rules.json, never from a literal here.
   That file exists because the same question was answered twice in two
   languages and drifted four times in one evening; a script spelling out its
   own idea of a win would be the fifth. Same keys src/lib/sales-rules.ts
   reads. */
const rules = JSON.parse(readFileSync("sales-rules.json", "utf8"));
const WINNING = rules.outcomes.winning;
const REFUND = rules.outcomes.refund.name;
/** A payment proves a sale once it reaches this. Same file the page reads. */
const MIN_DEPOSIT = rules.min_deposit.value;
const NO_SHOW = "No show";
/** Below this a shortfall is rounding, not debt. Matches lib/collect.ts. */
const FLOOR = 50;

const money = (n) => `$${Math.round(n).toLocaleString()}`;
let mustFix = 0;

function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(2);
}

loadEnv();
const notionKey = process.env.NOTION_API_KEY;
const databaseId = process.env.NOTION_DATABASE_ID;
const whopKey = process.env.WHOP_API_KEY;
if (!notionKey || !databaseId) fail("NOTION_API_KEY and NOTION_DATABASE_ID are both needed.", "They are in .env.local.");
if (!whopKey) fail("WHOP_API_KEY is not set.", "The collect list cannot be checked without the processor it reads.");

let rows, buyers;
try {
  rows = await readTracker({ notionKey, databaseId });
  buyers = await readPayments({ whopKey });
} catch (err) {
  if (err instanceof LiveReadError) fail(err.message, err.hint);
  throw err;
}

/*
 * THE SAME POPULATION THE PANEL DRAWS FROM, which is not "rows marked
 * Customer". An outcome is frozen when the call ends and money is not: a
 * prospect recorded as a follow-up who pays four days later is a sale, and the
 * page counts them as one (see src/lib/settle.ts). A check that read the
 * outcome column alone would report a different population from the panel it
 * is checking and neither number would be wrong — which is how a check comes to
 * disagree with its own subject. First measured here: 6 unpriced against the
 * panel's 9, all three being rows the money settled.
 *
 * The rule is READ from sales-rules.json rather than written out again. That
 * file exists because this exact question was answered twice in two languages
 * and drifted four times in one evening.
 */
const NOT_NO_SHOW = rows.filter((r) => r.outcome !== NO_SHOW);
const matches = matchBuyers(NOT_NO_SHOW, [...buyers.values()], {
  emailOf: (r) => r.email,
  nameOf: (r) => r.name,
});

const isWin = (r) => {
  if (r.outcome === REFUND) return false;
  if (WINNING.includes(r.outcome ?? "")) return true;
  const m = matches.get(r);
  return Boolean(m && m.buyer.paid >= MIN_DEPOSIT);
};
const wins = NOT_NO_SHOW.filter(isWin);

console.log(`\nThe collect list, checked against Notion and Whop.`);
console.log(
  `${wins.length} won calls (${wins.filter((r) => !WINNING.includes(r.outcome ?? "")).length} of them settled by ` +
    `a payment rather than by the outcome typed on the day), ${buyers.size} buyers.\n`
);

/* ------------------------------------------------- 1. money that came back */

const refunded = wins
  .map((r) => ({ row: r, match: matches.get(r) }))
  .filter((x) => x.match && x.match.buyer.refunded > 0);

if (refunded.length) {
  const stillCustomer = refunded.filter((x) => x.row.outcome !== REFUND);
  if (stillCustomer.length) {
    mustFix += stillCustomer.length;
    console.log(
      `✗ ${stillCustomer.length} customer${stillCustomer.length === 1 ? " was" : "s were"} refunded and ` +
        `${stillCustomer.length === 1 ? "the row still says" : "their rows still say"} Customer.\n` +
        `  The processor's total is net of a refund, so each of these looks part paid.\n` +
        `  The panel drops them, and every money figure above it still counts them.\n` +
        `  Mark the row ${REFUND} in Notion.\n`
    );
    for (const x of stillCustomer) {
      console.log(
        `  ${x.row.date?.slice(0, 10) ?? "no date"}  ${(x.row.name || "Unknown").padEnd(24)} ` +
          `paid ${money(x.match.buyer.gross)}, refunded ${money(x.match.buyer.refunded)}  ${x.row.url}`
      );
    }
    console.log("");
  }
}

/* ------------------------------------ 2. what each listed row is resting on */

const listed = [];
for (const row of wins) {
  const match = matches.get(row);
  const price = row.priceClosed ?? 0;
  if (price <= 0) continue;
  const paid = match ? match.buyer.paid : row.cash;
  if (price - paid <= FLOOR) continue;
  if (match && match.buyer.refunded > 0) continue; // reported above, off the list
  listed.push({ row, match, price, paid, owed: price - paid });
}

const grade = (x) =>
  !x.match ? (x.row.email ? "no payment found" : "no email on the row") : x.match.certain ? "email" : "name only";

const weak = listed.filter((x) => grade(x) !== "email");
console.log(
  `${listed.length} rows would be listed, ${money(listed.reduce((s, x) => s + x.owed, 0))} owed.` +
    (weak.length ? ` ${weak.length} of them rest on less than an address match:` : " Every one is tied to a payment by email.")
);
for (const x of weak) {
  console.log(
    `  ⚠ ${(x.row.name || "Unknown").padEnd(24)} owes ${money(x.owed).padEnd(8)} ` +
      `${grade(x).padEnd(18)} ${x.row.url}`
  );
}
console.log("");

/* ------------------------------------------- 3. one sale written up twice */

/*
 * The shape that would send somebody to collect a deal that was already
 * collected: two won rows for what looks like one person, at least one of them
 * with no address, so the matcher can only give the money to one of them and
 * the other reads as a customer who never paid.
 *
 * Reported, never resolved. Two brothers, or a genuine second purchase, look
 * identical from here — and check-payments.mjs already refuses to guess at far
 * less ambiguous things than this.
 */
const DUPLICATE_DAYS = 14;
const dayOf = (r) => (r.date ? Date.parse(`${String(r.date).slice(0, 10)}T00:00:00Z`) : null);

/*
 * THREE CONDITIONS, BECAUSE A SHARED FIRST NAME IS NOT A FINDING.
 *
 * The first version reported every won row sharing a name token with another:
 * five pairs, of which one was real. "Brian" and "Brian Beshensky" are two
 * people, five weeks and a thousand dollars apart, each with their own address
 * — and a check that is wrong four times out of five is one people stop
 * reading, which costs more than it is worth.
 *
 * What separates the real one is not the name. It is that ONE OF THE PAIR HAS
 * NO ADDRESS, so nothing could check it, standing next to a row at THE SAME
 * PRICE within a FORTNIGHT. That is the shape of one sale typed twice, and it
 * is the only shape where the second copy reads as a customer who never paid.
 */
const suspicious = [];
for (let i = 0; i < wins.length; i++) {
  for (let j = i + 1; j < wins.length; j++) {
    const a = wins[i], b = wins[j];
    if (a.email && b.email) continue;
    const price = a.priceClosed ?? 0;
    if (price <= 0 || price !== (b.priceClosed ?? 0)) continue;
    const [da, db] = [dayOf(a), dayOf(b)];
    if (da == null || db == null || Math.abs(da - db) > DUPLICATE_DAYS * 864e5) continue;
    const tokensA = new Set(normalise(a.name).split(" ").filter((t) => t.length >= 3 && t !== "unknown"));
    if (![...normalise(b.name).split(" ")].some((t) => tokensA.has(t))) continue;
    // Only worth raising if one of them is actually on the list — a pair that
    // are both paid up is a curiosity, not a phone call about to go wrong.
    if (!listed.some((l) => l.row === a || l.row === b)) continue;
    suspicious.push([a, b]);
  }
}
const pairs = new Map(suspicious.map((pair) => [pair.map((r) => r.id).sort().join("|"), pair]));

if (pairs.size) {
  console.log(
    `⚠ ${pairs.size} pair${pairs.size === 1 ? "" : "s"} of won rows share a name and a price within a ` +
      `fortnight, with no address on one side.\n` +
      `  One sale written up twice looks exactly like this: the money can only be given to one\n` +
      `  of the rows, and the other reads as a customer who never paid a penny. Open both.\n`
  );
  for (const pair of pairs.values()) {
    console.log(`  "${pair[0].name}" / "${pair[1].name}"`);
    for (const r of pair) {
      const m = matches.get(r);
      console.log(
        `     ${r.date?.slice(0, 10) ?? "no date"}  ${money(r.priceClosed ?? 0).padEnd(8)} ` +
          `${(r.email ?? "no email").padEnd(30)} ` +
          `${m ? `whop ${money(m.buyer.paid)}` : "no whop match"}  ${r.url}`
      );
    }
  }
  console.log("");
}

/* ---------------------------------------- 4. money for a different product */

/*
 * Every balance here is a lifetime total measured against one deal's price. On
 * an account selling one thing that is the same number. The day a second offer
 * appears it stops being, and every balance quietly understates — so this
 * watches for it rather than waiting for somebody to notice.
 *
 * On this account the second product is titled "Payment", a catch-all for
 * taking instalments rather than a rival offer, which is why the check names
 * the products instead of counting them.
 */
const products = new Map();
for (const b of buyers.values()) for (const p of b.products) products.set(p, (products.get(p) ?? 0) + 1);
if (products.size > 1) {
  console.log(
    `⚠ Payments span ${products.size} products. Every balance on the list is a lifetime total\n` +
      `  measured against ONE deal's price, so money for another offer makes it read low.\n` +
      `  Check these are instalment or deposit products rather than a second programme:`
  );
  for (const [id, count] of [...products].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${id}  ${count} buyer${count === 1 ? "" : "s"}`);
  }
  console.log("");
}

/* ------------------------------------------------------ 5. deals with no price */

const unpriced = wins.filter((r) => !(r.priceClosed > 0));
if (unpriced.length) {
  console.log(
    `⚠ ${unpriced.length} won call${unpriced.length === 1 ? " carries" : "s carry"} no price, so nothing can say ` +
      `whether ${unpriced.length === 1 ? "it owes" : "they owe"} anything.\n` +
      `  They cannot appear on the list at any amount. Put Price Closed on the row.\n`
  );
  for (const r of unpriced.slice(0, 10)) {
    console.log(`  ${r.date?.slice(0, 10) ?? "no date"}  ${(r.name || "Unknown").padEnd(24)} ${r.url}`);
  }
  if (unpriced.length > 10) console.log(`  … and ${unpriced.length - 10} more`);
  console.log("");
}

if (!mustFix) {
  console.log("Nothing on the list is a known-wrong amount. The ⚠ rows above need a person, not a fix.\n");
}
process.exit(mustFix ? 1 : 0);
