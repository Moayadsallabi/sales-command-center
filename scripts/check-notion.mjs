// Verifies the app can actually reach the Notion database it expects.
// Run with: npm run check:notion

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadEnv, NOTION_VERSION } from "./lib/notion-env.mjs";


const rubric = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "rubric", "rubric.json"),
    "utf8"
  )
);

// Property name -> the Notion type src/lib/notion.ts expects. The scorecard
// columns come from the rubric so adding a dimension only means editing
// rubric/rubric.json.
const REQUIRED_PROPS = {
  Name: "title",
  Closer: "select",
  "Call Date": "date",
  Outcome: "select",
  "Price Discussed": "number",
  "Price Closed": "number",
  "Payment Structure": "select",
  // Taken during the call itself — the only one of the three the workflow writes.
  "Collected On Call": "number",
  // Everything received to date, and what is still owed. Filled in by hand as
  // later payments land, so the workflow never touches them.
  "Cash Collected": "number",
  Outstanding: "number",
  // Which currency this row's amounts are in, and the rate used to fold them
  // into the dashboard's reporting currency.
  Currency: "select",
  "FX Rate": "number",
  "Prospect Revenue": "rich_text",
  Niche: "rich_text",
  Location: "rich_text",
  "Lead Source": "select",
  "Quality Score": "number",
  "Duration (min)": "number",
  "Recording URL": "url",
  // The join back to the KPI dashboard: a call is tied to a lead by the
  // prospect's email, the same key payments and DMs are tied by.
  "Prospect Email": "email",
  Summary: "rich_text",
  "The Moment": "rich_text",
  // Whose product was sold. Missing these does not break scoring, but it does
  // mean another offer's calls are counted as this client's with nothing to
  // notice — which is what happened before they existed.
  ...(rubric.offerMatch
    ? {
        [rubric.offerMatch.column]: "select",
        [rubric.offerMatch.evidenceColumn]: "rich_text",
      }
    : {}),
  "Next Call Drill": "rich_text",
  // Written by the workflow, not read by the dashboard: dedupe + provenance.
  "Recording ID": "number",
  "Rubric Version": "rich_text",
  ...Object.fromEntries(rubric.dimensions.map((d) => [d.column, "number"])),
  ...Object.fromEntries(
    rubric.bonusFlags.map((f) => [f.column, f.type === "enum" ? "select" : "checkbox"])
  ),
  // The lead-quality half: one column per factor, plus the normalised total and
  // the written read of what the factors add up to.
  ...Object.fromEntries(rubric.leadQuality.factors.map((f) => [f.column, "number"])),
  [rubric.leadQuality.column]: "number",
  [rubric.leadQuality.readColumn]: "rich_text",
  // Every objection voiced, and the one that decided the call.
  [rubric.objections.column]: "multi_select",
  [rubric.objections.primaryColumn]: "select",
};


function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

loadEnv();

const key = process.env.NOTION_API_KEY;
const rawId = process.env.NOTION_DATABASE_ID;

if (!key) {
  fail(
    "NOTION_API_KEY is not set.",
    "Create an internal integration at https://www.notion.so/my-integrations and put its secret in .env.local"
  );
}
if (!rawId) fail("NOTION_DATABASE_ID is not set in .env.local");

const id = rawId.replace(/-/g, "");
if (!/^[0-9a-f]{32}$/i.test(id)) {
  fail(`NOTION_DATABASE_ID "${rawId}" is not a 32-character Notion id.`);
}

const headers = {
  Authorization: `Bearer ${key}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json",
};

async function call(path, init = {}) {
  const resp = await fetch(`https://api.notion.com/v1/${path}`, {
    ...init,
    headers,
  });
  const body = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, body };
}

// 1. Is the token valid?
const me = await call("users/me");
if (!me.ok) {
  fail(
    `Notion rejected the token (${me.status}: ${me.body.code ?? "unknown"}).`,
    "Check NOTION_API_KEY in .env.local — it should start with ntn_ or secret_."
  );
}
console.log(`✓ Token valid — integration "${me.body.name ?? me.body.id}"`);

// 2. Can the integration see the database?
const db = await call(`databases/${id}`);
if (!db.ok) {
  if (db.status === 404) {
    // Same 404 for "not shared with the integration" and "that id isn't a
    // database" — probe the page endpoint to tell the two apart.
    const asPage = await call(`pages/${id}`);
    if (asPage.ok) {
      fail(
        "That id points at a page, not a database.",
        "Open the database as a full page in Notion and copy the id from that URL."
      );
    }
    fail(
      "The integration cannot see that database (404).",
      "Open the database in Notion → ••• → Connections → add your integration, then rerun."
    );
  }
  fail(`Could not read the database (${db.status}): ${db.body.message ?? ""}`);
}
const title = (db.body.title ?? []).map((t) => t.plain_text).join("") || "(untitled)";
console.log(`✓ Database reachable — "${title}"`);

// 3. Does its schema match what src/lib/notion.ts reads?
const actual = db.body.properties ?? {};
const missing = [];
const mismatched = [];
for (const [name, type] of Object.entries(REQUIRED_PROPS)) {
  const prop = actual[name];
  if (!prop) missing.push(name);
  else if (prop.type !== type) mismatched.push(`${name}: expected ${type}, found ${prop.type}`);
}

// 3b. A dropdown with nothing in it.
//
// This is the failure that has broken every install so far, and it is invisible
// to a check that only looks at names and types: the column is present, it is
// the right type, and the first scored call still fails, because some Notion
// API surfaces reject a write naming an option that does not exist rather than
// creating it. `Closer` ships empty on purpose and has to be filled in by hand,
// so it gets its own message rather than being listed as a fault.
const optionsFor = (prop) => (prop.select ?? prop.multi_select)?.options ?? [];
const EXPECTED_OPTIONS = {
  Outcome: rubric.commercial.outcomes,
  "Payment Structure": rubric.commercial.paymentStructures,
  Currency: rubric.commercial.currencies,
  ...Object.fromEntries(
    rubric.bonusFlags
      .filter((f) => f.type === "enum")
      .map((f) => [f.column, f.options ?? []])
  ),
  [rubric.objections.column]: rubric.objections.types.map((t) => t.name),
  [rubric.objections.primaryColumn]: rubric.objections.types.map((t) => t.name),
};

const emptyDropdowns = [];
const incompleteDropdowns = [];
for (const [name, expected] of Object.entries(EXPECTED_OPTIONS)) {
  const prop = actual[name];
  if (!prop || (prop.type !== "select" && prop.type !== "multi_select")) continue;
  const have = new Set(optionsFor(prop).map((o) => o.name));
  if (have.size === 0) {
    emptyDropdowns.push(name);
    continue;
  }
  const gaps = expected.filter((o) => !have.has(o));
  if (gaps.length) incompleteDropdowns.push(`${name}: missing ${gaps.join(", ")}`);
}

const closer = actual.Closer;
const closerEmpty =
  closer && closer.type === "select" && optionsFor(closer).length === 0;

if (missing.length) {
  console.warn(`\n⚠ Missing properties (these will read as empty):\n  - ${missing.join("\n  - ")}`);
}
if (mismatched.length) {
  console.warn(`\n⚠ Type mismatches (these will read as empty):\n  - ${mismatched.join("\n  - ")}`);
}
if (!missing.length && !mismatched.length) {
  console.log(`✓ All ${Object.keys(REQUIRED_PROPS).length} expected properties present`);
}

if (emptyDropdowns.length || incompleteDropdowns.length) {
  console.error(
    `\n✗ Dropdowns with no choices in them — the first scored call will fail on these:` +
      (emptyDropdowns.length ? `\n  - ${emptyDropdowns.join("\n  - ")}` : "") +
      (incompleteDropdowns.length ? `\n  - ${incompleteDropdowns.join("\n  - ")}` : "") +
      `\n\n  Fix: npm run fix:notion -- --apply`
  );
} else {
  console.log("✓ Every dropdown has its choices filled in");
}

if (closerEmpty) {
  console.warn(
    "\n⚠ `Closer` has no names in it yet. It is the one dropdown nobody can fill" +
      "\n  in for you — open the database and type your closers' names, spelled" +
      "\n  exactly as the calendar invite spells them, before the first call."
  );
}

// 4. Can we actually query rows?
const query = await call(`databases/${id}/query`, {
  method: "POST",
  body: JSON.stringify({ page_size: 100 }),
});
if (!query.ok) {
  fail(`Query failed (${query.status}): ${query.body.message ?? ""}`);
}
const count = query.body.results.length;
console.log(
  `✓ Query works — ${count}${query.body.has_more ? "+" : ""} row${count === 1 ? "" : "s"} readable`
);

/*
 * 5. IS THE SAME CALL ON THE TRACKER TWICE?
 *
 * The workflow asks Notion whether a recording is already logged before it
 * writes, and that check cannot win a race: two deliveries of one Fathom
 * webhook both look, both see nothing, and both write. It happened three times
 * in August 2026 and nothing said so — a second copy of a real call looks
 * exactly like a real call, so it quietly inflated calls recorded, calls taken,
 * the close-rate denominator, cash and the average score together.
 *
 * The dashboard now collapses these when it reads (`dedupeByRecording`), so the
 * numbers are right either way. This is the other half: the rows are still in
 * Notion, a person has to archive them, and nothing would ever have mentioned
 * them. Reported, never a failure — the page is not wrong because of them.
 *
 * Reads every page rather than the first hundred: a duplicate is exactly as
 * likely on row 300, and reporting "no duplicates" having looked at a quarter
 * of the tracker is the kind of half-true this repo keeps paying for.
 */
const seen = new Map();
let cursor;
do {
  const page = await call(`databases/${id}/query`, {
    method: "POST",
    body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
  });
  if (!page.ok) break;
  for (const row of page.body.results ?? []) {
    const rid = row.properties?.["Recording ID"]?.number;
    if (rid == null) continue;
    const entry = seen.get(rid) ?? [];
    entry.push({
      id: row.id,
      name: (row.properties?.Name?.title ?? []).map((t) => t.plain_text).join("") || "Unknown",
      date: row.properties?.["Call Date"]?.date?.start ?? "no date",
    });
    seen.set(rid, entry);
  }
  cursor = page.body.has_more ? page.body.next_cursor : undefined;
} while (cursor);

const duplicated = [...seen.entries()].filter(([, rows]) => rows.length > 1);
if (duplicated.length === 0) {
  console.log("✓ Every recording appears on the tracker once");
} else {
  console.log(
    `\n⚠ ${duplicated.length} recording${duplicated.length === 1 ? " is" : "s are"} on the tracker more than once.` +
      "\n  The dashboard counts each of them once, so its figures are right. These are the\n" +
      "  rows to archive in Notion, newest copy or oldest — they are the same call:\n"
  );
  for (const [rid, rows] of duplicated) {
    console.log(`  ${rows[0].date}  ${rows[0].name}  — recording ${rid}, ${rows.length} rows`);
    for (const row of rows) {
      console.log(`      https://www.notion.so/${row.id.replace(/-/g, "")}`);
    }
  }
}

// An empty dropdown is a hard failure rather than a warning: unlike a missing
// column, which reads as blank and loses one field, it rejects the whole write
// and the call never lands at all.
if (emptyDropdowns.length || incompleteDropdowns.length) {
  console.error("\nNot ready — run `npm run fix:notion -- --apply`, then rerun this.");
  process.exit(1);
}

console.log(
  missing.length || mismatched.length
    ? "\nConnected, with schema warnings above."
    : "\nConnected. `npm run dev` will load live data."
);
