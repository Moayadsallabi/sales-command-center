#!/usr/bin/env node
/**
 * Are calls actually reaching the tracker?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * On 14 and 15 August 2026 the automation ran ZERO times while Fathom held
 * seven recordings. Everything that reached the tracker for that period
 * arrived in one burst on the 16th — fifty runs in seven minutes, which is a
 * person running the catch-up by hand, not calls arriving as they happen.
 *
 * Nothing alerted, and the reason is worth stating plainly: the Slack alert
 * fires when the automation RUNS and turns a call away. If nothing is
 * delivered, nothing is turned away, so nothing alerts. Silence looked
 * identical to health. It was the opposite.
 *
 * So this compares the two ends directly — what the recorder has against what
 * the tracker has — and says which recordings never made it.
 *
 * ---------------------------------------------------------------------------
 * IT DOES NOT REIMPLEMENT THE SALES-CALL RULE
 *
 * Whether a recording SHOULD have been scored is decided by the same
 * expression the live workflow uses, read straight out of the generated
 * workflow file. A second copy of that rule here would agree until the day it
 * did not, and this whole system has spent a week paying for duplicated rules.
 *
 *   npm run check:delivery                 last 7 days
 *   npm run check:delivery -- --days 30
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

for (const file of [".env.local", ".env"]) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const days = Number(argOf("days", 7));
const client = argOf("client", "brey");
const since = new Date(Date.now() - days * 864e5);

/* ------------------------------------- the workflow's own sales-call rule */

const workflowPath = join(root, "automation/generated", `sales-call-tracker-${client}.json`);
if (!existsSync(workflowPath)) {
  console.error(`\n✗ No generated workflow for "${client}" at ${workflowPath}`);
  console.error("  Run configure:client first, so this check can read its filter.\n");
  process.exit(1);
}
const workflow = JSON.parse(readFileSync(workflowPath, "utf8"));
const node = workflow.nodes.find((n) => n.name === "Is Sales Call?");
const expr = node.parameters.conditions.conditions[0].leftValue
  .replace(/^=\{\{/, "")
  .replace(/\}\}$/, "");
const isSalesCall = (title) =>
  new Function("$json", `return (${expr});`)({ body: { meeting_title: title } });

/* ------------------------------------------------------------ the tracker */

const notionKey = process.env.NOTION_API_KEY;
const database = process.env.NOTION_DATABASE_ID;
if (!notionKey || !database) {
  console.error("\n✗ NOTION_API_KEY and NOTION_DATABASE_ID are needed.\n");
  process.exit(1);
}

const rows = [];
let cursor;
do {
  const res = await fetch(`https://api.notion.com/v1/databases/${database}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ page_size: 100, start_cursor: cursor }),
  });
  if (!res.ok) {
    console.error(`\n✗ Notion refused the tracker (${res.status}).\n`);
    process.exit(1);
  }
  const body = await res.json();
  rows.push(...(body.results ?? []));
  cursor = body.next_cursor;
  if (!body.has_more) break;
} while (cursor);

const read = (p) =>
  p?.number ?? p?.select?.name ?? p?.rich_text?.[0]?.plain_text ??
  p?.title?.[0]?.plain_text ?? p?.date?.start ?? null;

const trackedIds = new Set();
const trackedNames = new Set();
for (const row of rows) {
  const id = read(row.properties["Recording ID"]);
  if (id != null) trackedIds.add(String(id));
  const name = read(row.properties["Name"]);
  if (name) trackedNames.add(String(name).toLowerCase().trim());
}

/* ----------------------------------------------------------- the recorder */

const keys = Object.entries(process.env)
  .filter(([k, v]) => k.startsWith("FATHOM_KEY_") && v)
  .map(([k, v]) => [k.replace("FATHOM_KEY_", ""), v]);

if (keys.length === 0) {
  console.error("\n✗ No FATHOM_KEY_* set, so there is nothing to compare against.\n");
  process.exit(1);
}

const missing = [];
const forReview = [];
let salesRecordings = 0;
let delivered = 0;
const perOwner = [];

for (const [owner, key] of keys) {
  let url =
    `https://api.fathom.ai/external/v1/meetings` +
    `?created_after=${encodeURIComponent(since.toISOString())}&include_transcript=false`;
  let count = 0;
  let pages = 0;
  while (url && pages < 20) {
    const res = await fetch(url, { headers: { "X-Api-Key": key } });
    if (!res.ok) {
      console.error(`  ! ${owner}: Fathom refused (${res.status})`);
      break;
    }
    const body = await res.json();
    pages++;
    for (const meeting of body.items ?? body.data ?? []) {
      count++;
      const title = String(meeting.title ?? meeting.meeting_title ?? "").replace(/\s+/g, " ").trim();
      const when = String(meeting.scheduled_start_time ?? meeting.created_at ?? "").slice(0, 10);
      const id = meeting.recording_id ?? meeting.id ?? null;

      if (!isSalesCall(title)) {
        forReview.push({ owner, when, title });
        continue;
      }
      salesRecordings++;
      // Match on the recorder's own id first; fall back to the prospect's name
      // out of the title, for rows written before the id column existed.
      const byId = id != null && trackedIds.has(String(id));
      const person = title.split(/[:—-]/)[0].toLowerCase().trim();
      const byName = person.length > 2 && trackedNames.has(person);
      if (byId || byName) delivered++;
      else missing.push({ owner, when, title, id });
    }
    url = body.next_cursor
      ? `https://api.fathom.ai/external/v1/meetings?cursor=${encodeURIComponent(body.next_cursor)}` +
        `&created_after=${encodeURIComponent(since.toISOString())}&include_transcript=false`
      : null;
  }
  perOwner.push({ owner, count });
}

/* -------------------------------------------------------------- reporting */

console.log(`\nDelivery check — last ${days} days, client "${client}"\n`);
for (const { owner, count } of perOwner) {
  const note = count === 0 ? "   ← nothing recorded at all" : "";
  console.log(`  ${String(count).padStart(4)} recordings   ${owner}${note}`);
}
console.log(`\n  ${salesRecordings} of those are sales calls by the workflow's own rule`);
console.log(`  ${delivered} reached the tracker`);
console.log(`  ${missing.length} did not`);

let bad = false;

const silent = perOwner.filter((o) => o.count === 0);
if (silent.length) {
  console.log(
    `\n⚠ ${silent.map((o) => o.owner).join(", ")} recorded NOTHING in ${days} days.` +
      `\n  Either they took no calls, or their recorder is no longer joining them.`
  );
  bad = true;
}

if (missing.length) {
  console.log(`\n✗ ${missing.length} sales recordings never reached the tracker:\n`);
  for (const m of missing.slice(0, 25)) {
    console.log(`    ${m.when}  ${m.owner.padEnd(10)} ${m.title.slice(0, 58)}`);
  }
  if (missing.length > 25) console.log(`    … and ${missing.length - 25} more`);
  console.log(
    `\n  These are calls the automation SHOULD have scored and has not. Usually the` +
      `\n  recorder is not sending them: check the webhook is still connected for the` +
      `\n  owners above. \`npm run backfill:fathom\` replays them once it is.`
  );
  bad = true;
}

if (forReview.length) {
  console.log(
    `\n· ${forReview.length} recordings were not sales calls by the rule, so they were` +
      `\n  correctly left out. Ad-hoc titles among them need a human eye:\n`
  );
  const adhoc = forReview.filter((f) => /impromptu|meeting$/i.test(f.title));
  for (const f of adhoc.slice(0, 10)) {
    console.log(`    ${f.when}  ${f.owner.padEnd(10)} ${f.title.slice(0, 58)}`);
  }
  if (adhoc.length === 0) console.log("    (none — every one was a named non-sales meeting)");
}

if (!bad) {
  console.log(`\n✓ Every sales recording in the window reached the tracker.\n`);
  process.exit(0);
}
console.log("");
process.exit(1);
