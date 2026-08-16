// Adds any missing column to the Notion tracker, so an older database catches up
// with the schema the dashboard and workflow expect. Only ever creates columns —
// it never edits or deletes one that already exists, so running it twice is safe.
//
// Dry run (default): npm run fix:notion
// Apply:             npm run fix:notion -- --apply
//
// Defaults to NOTION_DATABASE_ID. Pass --database <id> to point it at another
// tracker — the master template, or a client's — without editing any env file.
// The integration must be added to that database under ••• → Connections first.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const NOTION_VERSION = "2022-06-28";
const APPLY = process.argv.includes("--apply");

const rubric = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "rubric", "rubric.json"),
    "utf8"
  )
);

// The Notion definition for every column, keyed by name. Same source of truth as
// check-notion.mjs: the scorecard columns come from the rubric, so adding a
// dimension there is all it takes for this to create it.
const SPEC = {
  Name: { title: {} },
  Closer: { select: {} },
  "Call Date": { date: {} },
  "Prospect Email": { email: {} },
  Outcome: {
    select: {
      options: ["Customer", "BAMFAM", "No offer made", "No deal", "No show", "REFUND"].map(
        (name) => ({ name })
      ),
    },
  },
  Tier: { select: { options: [{ name: "Tier 1" }, { name: "Tier 2" }] } },
  "Price Discussed": { number: {} },
  "Price Closed": { number: {} },
  "Payment Structure": {
    select: { options: ["PIF", "installments", "custom"].map((name) => ({ name })) },
  },
  "Collected On Call": { number: {} },
  "Cash Collected": { number: {} },
  Outstanding: { number: {} },
  Currency: {
    select: {
      options: (rubric.commercial.currencies ?? ["USD"]).map((name) => ({ name })),
    },
  },
  "FX Rate": { number: {} },
  "Prospect Revenue": { rich_text: {} },
  Niche: { rich_text: {} },
  Location: { rich_text: {} },
  "Lead Source": {
    select: {
      options: ["Skool", "IG", "YouTube", "Referral", "Direct", "Unknown"].map((name) => ({
        name,
      })),
    },
  },
  "Quality Score": { number: {} },
  "Duration (min)": { number: {} },
  "Recording URL": { url: {} },
  Summary: { rich_text: {} },
  "The Moment": { rich_text: {} },
  "Next Call Drill": { rich_text: {} },
  "Recording ID": { number: {} },
  "Rubric Version": { rich_text: {} },
  ...Object.fromEntries(rubric.dimensions.map((d) => [d.column, { number: {} }])),
  ...Object.fromEntries(
    rubric.bonusFlags.map((f) => [
      f.column,
      // `options`, not `values` — the key this read until 2026-08-16, which
      // silently created the select with no options at all. Notion rejects a
      // write naming an option that does not exist, so every scored call failed
      // on Weakest Belief until the column was fixed by hand.
      f.type === "enum"
        ? { select: { options: (f.options ?? []).map((name) => ({ name })) } }
        : { checkbox: {} },
    ])
  ),
  ...Object.fromEntries(rubric.leadQuality.factors.map((f) => [f.column, { number: {} }])),
  [rubric.leadQuality.column]: { number: {} },
  [rubric.leadQuality.readColumn]: { rich_text: {} },
  [rubric.objections.column]: {
    multi_select: { options: rubric.objections.types.map((t) => ({ name: t.name })) },
  },
  [rubric.objections.primaryColumn]: {
    select: { options: rubric.objections.types.map((t) => ({ name: t.name })) },
  },
};

const typeOf = (definition) => Object.keys(definition)[0];

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
const flagIndex = process.argv.indexOf("--database");
const overrideId = flagIndex === -1 ? null : process.argv[flagIndex + 1];
const rawId = overrideId ?? process.env.NOTION_DATABASE_ID;

if (!key) fail("NOTION_API_KEY is not set.", "Put it in .env.local, or run through `railway run`.");
if (flagIndex !== -1 && !overrideId) fail("--database needs an id after it.");
if (!rawId) fail("NOTION_DATABASE_ID is not set.", "Or pass --database <id>.");

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
  const resp = await fetch(`https://api.notion.com/v1/${path}`, { ...init, headers });
  const body = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, body };
}

const db = await call(`databases/${id}`);
if (!db.ok) {
  fail(
    `Could not read the database (${db.status}): ${db.body.message ?? ""}`,
    "Run `npm run check:notion` first — it explains the common causes."
  );
}
const title = (db.body.title ?? []).map((t) => t.plain_text).join("") || "(untitled)";
console.log(`Database: "${title}"`);

const actual = db.body.properties ?? {};
const missing = Object.keys(SPEC).filter((name) => !actual[name]);
const mismatched = Object.entries(SPEC)
  .filter(([name, def]) => actual[name] && actual[name].type !== typeOf(def))
  .map(([name, def]) => `${name}: expected ${typeOf(def)}, found ${actual[name].type}`);

if (mismatched.length) {
  // A wrong type is a rename or a hand-edit, and changing it could drop the data
  // already in that column. Report and leave it alone.
  console.warn(
    `\n⚠ Wrong type — not touching these, fix them by hand in Notion:\n  - ${mismatched.join("\n  - ")}`
  );
}

if (!missing.length) {
  console.log("\n✓ Nothing to add — every expected column already exists.");
  process.exit(0);
}

console.log(`\n${missing.length} column${missing.length === 1 ? "" : "s"} to add:`);
for (const name of missing) {
  const def = SPEC[name];
  // Multi-select carries its options in its own key, so listing only `select`
  // would print the objection column as if it were being created bare.
  const options = (def.select ?? def.multi_select)?.options
    ?.map((o) => o.name)
    .join(", ");
  console.log(`  + ${name} (${typeOf(def)})${options ? ` — options: ${options}` : ""}`);
}

if (!APPLY) {
  console.log("\nDry run — nothing was changed. Rerun with --apply to create them.");
  process.exit(0);
}

const patch = await call(`databases/${id}`, {
  method: "PATCH",
  body: JSON.stringify({
    properties: Object.fromEntries(missing.map((name) => [name, SPEC[name]])),
  }),
});

if (!patch.ok) {
  fail(`Notion rejected the change (${patch.status}): ${patch.body.message ?? ""}`);
}

const after = patch.body.properties ?? {};
const created = missing.filter((name) => after[name]);
const failed = missing.filter((name) => !after[name]);

console.log(`\n✓ Added ${created.length} column${created.length === 1 ? "" : "s"}.`);
if (failed.length) {
  fail(`Notion did not create: ${failed.join(", ")}`);
}
console.log("Run `npm run check:notion` to confirm.");
