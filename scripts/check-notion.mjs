// Verifies the app can actually reach the Notion database it expects.
// Run with: npm run check:notion

import { readFileSync } from "node:fs";

const NOTION_VERSION = "2022-06-28";

// Property name -> the CallRecord field src/lib/notion.ts maps it to.
const REQUIRED_PROPS = {
  Name: "title",
  "Call Date": "date",
  Outcome: "select",
  Tier: "select",
  "Price Discussed": "number",
  "Price Closed": "number",
  "Payment Structure": "select",
  "Cash Collected": "number",
  "Prospect Revenue": "rich_text",
  Niche: "rich_text",
  Location: "rich_text",
  "Lead Source": "select",
  "Quality Score": "number",
  "Duration (min)": "number",
  "Recording URL": "url",
  Summary: "rich_text",
};

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

if (missing.length) {
  console.warn(`\n⚠ Missing properties (these will read as empty):\n  - ${missing.join("\n  - ")}`);
}
if (mismatched.length) {
  console.warn(`\n⚠ Type mismatches (these will read as empty):\n  - ${mismatched.join("\n  - ")}`);
}
if (!missing.length && !mismatched.length) {
  console.log(`✓ All ${Object.keys(REQUIRED_PROPS).length} expected properties present`);
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

console.log(
  missing.length || mismatched.length
    ? "\nConnected, with schema warnings above."
    : "\nConnected. `npm run dev` will load live data."
);
