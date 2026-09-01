#!/usr/bin/env node
/**
 * HOW MANY RECENT CALLS ARRIVED CARRYING THE PROSPECT'S ADDRESS.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS WORTH A SCHEDULED CHECK
 *
 * `Prospect Email` is the key every join in this system runs on — the booking
 * behind a call, the payment that followed it, the ad that produced the lead.
 * The workflow can only take it from ONE place: an external guest on the
 * calendar invite Fathom recorded. No guest, no address — and usually no name
 * either, which is why a tracker row can read "Unknown".
 *
 * Nothing fails when it is missing. The joins simply do not happen, so the
 * dashboard shows revenue with no call attached and calls with no revenue, and
 * both figures are individually correct. That is a fault you can only find by
 * going and looking, which is exactly the kind this repo turns into a command.
 *
 * Measured on Brey's account, it was not a steady leak but a fast-growing one:
 *
 *     June       0 of 4     0%
 *     July       4 of 44    9%
 *     August    27 of 78   35%
 *
 * A process change, not drift. The ask went to the team on 2026-09-01: put the
 * prospect on the invite as a guest, book through the Calendly link, and
 * reschedule rather than recreate. This is how anyone finds out whether it took,
 * without having to remember to ask.
 *
 * ---------------------------------------------------------------------------
 * A ROLLING WINDOW, NOT A LIFETIME TOTAL
 *
 * The fix can only affect calls recorded AFTER it. A lifetime figure is dragged
 * down by every row already on the tracker and would take months to move, so it
 * would say "no better" while the habit was working perfectly. This counts the
 * last fourteen days and nothing else.
 *
 * It also refuses to judge a small window: on three calls, one missing address
 * is 33% and means nothing. Below MIN_CALLS it reports the count and declines
 * to give a verdict, rather than producing a percentage that reads like one.
 */
import { loadEnv, notionHeaders } from "./lib/notion-env.mjs";

loadEnv();

const DAYS = Number(process.env.IDENTIFIED_WINDOW_DAYS || 14);
/**
 * Above this share missing, the team is asked again. Set between July's 9% and
 * August's 35%: comfortably worse than the account has managed, comfortably
 * better than the month that prompted the ask, so it fires on a real return of
 * the problem and not on one awkward week.
 */
const BAR = Number(process.env.IDENTIFIED_BAR || 0.2);
/** Below this many calls the window cannot support a percentage at all. */
const MIN_CALLS = 10;

const apiKey = process.env.NOTION_API_KEY;
const databaseId = (process.env.NOTION_DATABASE_ID || "").replace(/-/g, "");
if (!apiKey || !databaseId) {
  console.error("NOTION_API_KEY and NOTION_DATABASE_ID must be set.");
  process.exit(2);
}

const since = new Date();
since.setUTCDate(since.getUTCDate() - DAYS);
const from = since.toISOString().slice(0, 10);

const rows = [];
let cursor;
do {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: "POST",
    headers: notionHeaders(apiKey),
    body: JSON.stringify({
      page_size: 100,
      start_cursor: cursor,
      filter: { property: "Call Date", date: { on_or_after: from } },
    }),
  });
  if (!res.ok) {
    console.error(`Notion refused the query (${res.status}). Coverage is UNKNOWN.`);
    process.exit(2);
  }
  const body = await res.json();
  rows.push(...(body.results ?? []));
  cursor = body.has_more ? body.next_cursor : undefined;
} while (cursor);

const title = (p) => (p?.title ?? []).map((t) => t.plain_text).join("");
const num = (p) => p?.number ?? null;

/*
 * One row per recording, the same rule the dashboard reads by. Two copies of
 * one call would otherwise count twice on whichever side they fell, and this
 * figure is a rate — so a duplicate does not just inflate it, it moves it.
 */
const seen = new Set();
const calls = [];
for (const row of rows) {
  const rid = num(row.properties?.["Recording ID"]);
  if (rid != null) {
    if (seen.has(rid)) continue;
    seen.add(rid);
  }
  calls.push({
    name: title(row.properties?.Name) || "Unknown",
    date: row.properties?.["Call Date"]?.date?.start ?? null,
    email: (row.properties?.["Prospect Email"]?.email ?? "").trim(),
  });
}

const withEmail = calls.filter((c) => c.email);
const without = calls.filter((c) => !c.email);
// The worst of them: no address AND no name, so nothing identifies the prospect
// at all and no later fix can recover who they were.
const anonymous = without.filter((c) => c.name === "Unknown");
const share = calls.length ? without.length / calls.length : 0;
const pct = Math.round(share * 100);

console.log(`Calls in the last ${DAYS} days: ${calls.length}`);
console.log(`  carrying the prospect's email: ${withEmail.length}`);
console.log(`  missing it                   : ${without.length}${pct ? `  (${pct}%)` : ""}`);
if (anonymous.length) {
  console.log(`  of those, no name either     : ${anonymous.length}  — nothing can recover who these were`);
}

if (calls.length < MIN_CALLS) {
  console.log(
    `\n· Too few calls in this window to judge a rate (${calls.length}, needs ${MIN_CALLS}).`
  );
  process.exit(0);
}

if (without.length > 0) {
  console.log("\nCalls with no address on them:\n");
  for (const c of without.slice(0, 12)) {
    console.log(`  ${c.date ?? "no date"}  ${c.name}`);
  }
  if (without.length > 12) console.log(`  … and ${without.length - 12} more`);
}

if (share > BAR) {
  console.log(
    `\n⚠ ${pct}% of recent calls arrived with no way to tie them to a payment.\n` +
      "  The address comes from an external guest on the calendar invite, so this is\n" +
      "  a booking habit rather than anything in the software: book through the\n" +
      "  Calendly link, put the prospect on the invite, and reschedule rather than\n" +
      "  recreate. Every join on these rows silently does not happen."
  );
  process.exit(1);
}

console.log(`\n✓ ${100 - pct}% of recent calls can be tied to a payment and a booking.`);
