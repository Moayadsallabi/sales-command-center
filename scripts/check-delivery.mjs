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
 *   npm run check:delivery                        last 7 days
 *   npm run check:delivery -- --days 30
 *   npm run check:delivery -- --since 2026-08-25
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readSalesCallFilter, SalesCallFilterError } from "./lib/sales-call-filter.mjs";
import { readAllRecordings } from "./lib/fathom.mjs";
import { NOTION_VERSION } from "./lib/notion-env.mjs";
import { requireEnv } from "./lib/required-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Loads the env files and stops with exit 3 if this deploy has none of what
// the comparison needs. Declared in lib/required-env.mjs, which the weekly
// report reads too — see its header for the morning that made it necessary.
requireEnv("check-delivery.mjs");

/**
 * Arguments, with an unknown one treated as an ERROR rather than ignored.
 *
 * The weekly report asked this script for two weeks by passing `--since`, which
 * it did not understand and silently dropped — so it checked seven days while
 * the Slack message it fed said "the last two weeks". Nothing failed; the
 * sentence was simply about a window nobody had measured.
 *
 * A caller and a script are two readers of one argument list. Ignoring what it
 * does not recognise is how they drift without anyone finding out, so an
 * unrecognised flag stops the run.
 */
const KNOWN = new Set(["days", "since", "client"]);
for (const token of process.argv.slice(2)) {
  if (!token.startsWith("--")) continue;
  if (KNOWN.has(token.slice(2))) continue;
  console.error(`\n✗ ${token} is not an option this check understands.`);
  console.error(`  It takes: ${[...KNOWN].map((k) => "--" + k).join(", ")}.\n`);
  process.exit(2);
}

const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const client = argOf("client", "brey");

/**
 * The start of the window, from either `--since YYYY-MM-DD` or `--days N`.
 * `--since` wins when both are given, because it is the more specific of the
 * two — check-dropped takes the same argument and means the same thing by it.
 */
const sinceArg = argOf("since", null);
const days = Number(argOf("days", 7));
let since;
if (sinceArg) {
  since = new Date(`${sinceArg}T00:00:00Z`);
  if (Number.isNaN(since.getTime())) {
    console.error(`\n✗ --since ${sinceArg} is not a date. Use YYYY-MM-DD.\n`);
    process.exit(2);
  }
} else {
  since = new Date(Date.now() - days * 864e5);
}
const windowLabel = sinceArg ? `since ${sinceArg}` : `last ${days} days`;

/* ------------------------------------- the workflow's own sales-call rule */

let isSalesCall;
try {
  ({ isSalesCall } = readSalesCallFilter(client, { root }));
} catch (err) {
  if (!(err instanceof SalesCallFilterError)) throw err;
  console.error(`\n✗ ${err.message}`);
  if (err.hint) console.error(`  ${err.hint}`);
  console.error("");
  process.exit(1);
}

/* ------------------------------------------------------------ the tracker */

const notionKey = process.env.NOTION_API_KEY;
const database = process.env.NOTION_DATABASE_ID;

const rows = [];
let cursor;
do {
  const res = await fetch(`https://api.notion.com/v1/databases/${database}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
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


/**
 * Closers whose recordings could not be read.
 *
 * A failed read used to leave a stderr line and nothing else, so the report
 * below still printed its counts and its "everything was delivered" verdict
 * over a closer it had not read. Silence about a partial read is the same
 * fault this whole script exists to catch, one level up.
 */
const incomplete = [];
const missing = [];
const forReview = [];
let salesRecordings = 0;
let delivered = 0;
const perOwner = [];

for (const [owner, key] of keys) {
  let meetings;
  try {
    meetings = await readAllRecordings(key, {
      createdAfter: since.toISOString(),
      // Both are part of the sales-call rule: the transcript decides an ad-hoc
      // call on its second voice, and the summary is where a DIFFERENT offer
      // names itself. Asking for one and not the other asks a question the rule
      // does not answer.
      params: { include_transcript: "true", include_summary: "true" },
    });
  } catch (err) {
    incomplete.push(owner);
    console.error(`  ! ${owner}: ${err.message}`);
    perOwner.push({ owner, count: 0 });
    continue;
  }

  let count = 0;
  for (const meeting of meetings) {
      count++;
      const title = String(meeting.title ?? meeting.meeting_title ?? "").replace(/\s+/g, " ").trim();
      const when = String(meeting.scheduled_start_time ?? meeting.created_at ?? "").slice(0, 10);
      const id = meeting.recording_id ?? meeting.id ?? null;

      /* ASKED WITH THE WHOLE RECORDING, NOT JUST THE TITLE (2026-08-25).

         The rule stopped being about titles alone on 2026-08-24 — a call whose
         title names nothing is accepted when it ran 15+ minutes with a second
         voice, and refused when Fathom's summary says it was sold on another
         offer. readSalesCallFilter's own comment warns that a title with an
         empty body "answers a question the rule no longer answers".

         This is the THIRD caller found doing it, after backfill-fathom.mjs.
         The cost here is the worst of the three: this is the tool that says
         whether calls are reaching the tracker, and with a bare title it files
         every ad-hoc recording under "not a sales call, correctly left out" —
         so a genuine delivery failure is reported as the rule working. */
      if (!isSalesCall(title, {
        meeting_title: title,
        recording_start_time: meeting.recording_start_time,
        recording_end_time: meeting.recording_end_time,
        recorded_by: meeting.recorded_by,
        transcript: meeting.transcript,
        default_summary: meeting.default_summary,
      })) {
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
  perOwner.push({ owner, count });
}

/* -------------------------------------------------------------- reporting */

console.log(`\nDelivery check — ${windowLabel}, client "${client}"\n`);
for (const { owner, count } of perOwner) {
  const note = count === 0 ? "   ← nothing recorded at all" : "";
  console.log(`  ${String(count).padStart(4)} recordings   ${owner}${note}`);
}
console.log(`\n  ${salesRecordings} of those are sales calls by the workflow's own rule`);
console.log(`  ${delivered} reached the tracker`);
console.log(`  ${missing.length} did not`);

let bad = false;

/* A PARTIAL READ IS NOT A CLEAN WEEK, AND IT USED TO PRINT LIKE ONE.
   The counts above, "N reached the tracker" and the ✓ at the bottom are all
   computed over whatever was read. A closer read halfway therefore produced a
   smaller, entirely plausible report with no warning attached — the same shape
   of fault this script exists to catch, one level up. Said first, because it
   changes what every figure above it means. */
if (incomplete.length) {
  console.log(
    `\n✗ ${[...new Set(incomplete)].join(", ")} could not be read in full, so EVERY` +
      `\n  figure above counts only part of their calls. Do not read this as a clean` +
      `\n  window. Wait a minute and run it again.`
  );
  bad = true;
}

// A closer we could not READ also has a count of zero, and "recorded nothing"
// makes a different claim from "we could not look" — one points at their
// recorder, the other at ours. Only the ones actually read can be silent.
const unread = new Set(incomplete);
const silent = perOwner.filter((o) => o.count === 0 && !unread.has(o.owner));
if (silent.length) {
  console.log(
    `\n⚠ ${silent.map((o) => o.owner).join(", ")} recorded NOTHING (${windowLabel}).` +
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
