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
import { loadEnv, NOTION_VERSION } from "./lib/notion-env.mjs";

const APPLY = process.argv.includes("--apply");

/** Price bands this client sells. Match whatever configure:client used. */
const tiersFlag = process.argv.indexOf("--tiers");
const tiersOverride = tiersFlag === -1 ? null : Number(process.argv[tiersFlag + 1]);
if (tiersFlag !== -1 && (!Number.isInteger(tiersOverride) || tiersOverride < 1)) {
  console.error("\n✗ --tiers needs a whole number after it, such as --tiers 3");
  process.exit(1);
}

const rubric = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "rubric", "rubric.json"),
    "utf8"
  )
);

const TIERS =
  tiersOverride != null
    ? Array.from({ length: tiersOverride }, (_, i) => i + 1)
    : rubric.commercial.tiers;

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
  // Only for a client whose offers genuinely come in tiers. With none
  // configured the column is not created at all, because a band nobody has
  // defined gets filled in by guesswork. `--tiers N` sets how many.
  ...(TIERS.length
    ? { Tier: { select: { options: TIERS.map((t) => ({ name: `Tier ${t}` })) } } }
    : {}),
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
      options: (rubric.commercial.leadSources ?? ["Unknown"]).map((name) => ({ name })),
    },
  },
  "Quality Score": { number: {} },
  "Duration (min)": { number: {} },
  "Recording URL": { url: {} },
  Summary: { rich_text: {} },
  "The Moment": { rich_text: {} },
  "Next Call Drill": { rich_text: {} },
  // Whose product was sold, and the line that decides it. The options must
  // exist before the first write: Notion rejects a write naming an option the
  // select does not have, which takes down the whole row, not just the field.
  ...(rubric.offerMatch
    ? {
        [rubric.offerMatch.column]: {
          select: { options: rubric.offerMatch.verdicts.map((name) => ({ name })) },
        },
        [rubric.offerMatch.evidenceColumn]: { rich_text: {} },
      }
    : {}),
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

/**
 * Choices missing from a dropdown that already exists.
 *
 * Adding the column was never the whole job. A `Weakest Belief` column present
 * but with an empty choice list is what broke the first two installs: the
 * column passed every check, and the first scored call was rejected outright
 * because it named a choice that did not exist. Creating columns fixed a
 * database that had none and did nothing at all for the far more common case
 * of a database built from an older template.
 */
const optionsOf = (definition) =>
  (definition.select ?? definition.multi_select)?.options ?? null;

const optionGaps = [];
for (const [name, definition] of Object.entries(SPEC)) {
  const wanted = optionsOf(definition);
  const live = actual[name];
  if (!wanted || !live || live.type !== typeOf(definition)) continue;

  const have = (live[live.type]?.options ?? []).map((o) => o.name);
  const gaps = wanted.map((o) => o.name).filter((o) => !have.includes(o));
  if (gaps.length) optionGaps.push({ name, type: live.type, have: live[live.type].options, gaps });
}

if (!missing.length && !optionGaps.length) {
  console.log("\n✓ Nothing to do — every column exists and every dropdown is filled in.");
  process.exit(0);
}

if (optionGaps.length) {
  console.log(`\n${optionGaps.length} dropdown${optionGaps.length === 1 ? "" : "s"} missing choices:`);
  for (const g of optionGaps) console.log(`  ~ ${g.name} — adding: ${g.gaps.join(", ")}`);
}

if (!missing.length) {
  if (!APPLY) {
    console.log("\nDry run — nothing was changed. Rerun with --apply to fill them in.");
    process.exit(0);
  }
  const patched = await call(`databases/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      properties: Object.fromEntries(
        // Existing choices are sent back with their ids so Notion keeps them
        // and their colours; sending only the new ones would replace the list.
        optionGaps.map((g) => [
          g.name,
          { [g.type]: { options: [...g.have, ...g.gaps.map((name) => ({ name }))] } },
        ])
      ),
    }),
  });
  if (!patched.ok) {
    fail(`Notion rejected the change (${patched.status}): ${patched.body.message ?? ""}`);
  }
  console.log(`\n✓ Filled in ${optionGaps.length} dropdown${optionGaps.length === 1 ? "" : "s"}.`);
  console.log("Run `npm run check:notion` to confirm.");
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
    properties: {
      ...Object.fromEntries(missing.map((name) => [name, SPEC[name]])),
      // Columns that already exist but are missing choices, fixed in the same
      // request so one run leaves the database ready rather than two.
      ...Object.fromEntries(
        optionGaps.map((g) => [
          g.name,
          { [g.type]: { options: [...g.have, ...g.gaps.map((name) => ({ name }))] } },
        ])
      ),
    },
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
