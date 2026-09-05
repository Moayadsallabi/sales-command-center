#!/usr/bin/env node
/**
 * Everything the systems say about one person, side by side, with the owner of
 * each fact named.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Four systems describe the same calls and they disagree constantly. Every round
 * of "is this figure right" was argued from whichever source was nearest to
 * hand, so the same argument kept happening — three times on the same kind of
 * question before Moayad asked for a method instead of another ruling
 * (2026-09-05).
 *
 * docs/verifying-a-number.md is that method. This is the method as a command,
 * because a rule someone has to remember to follow is the mechanism those rules
 * exist to replace.
 *
 *   npm run verify -- --who "Brian"
 *   npm run verify -- --email muthamibrian@yahoo.com
 *   npm run verify -- --recording 179884925
 *
 * It changes nothing. It reads, lays out, and says who owns what.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY WILL NOT DO
 *
 * It never picks a winner between two sources that do not own the fact. Where
 * the owner is the recording — what was agreed, which offer, how the call went —
 * it prints the lines to listen to and stops. Asserting a price from the two
 * non-owners is exactly how the wrong figure got defended.
 *
 * It never narrows to one candidate either. Every row it prints carries how it
 * was matched: an address is an identifier, two names agreeing is an inference,
 * one name is a hint.
 *
 * NOT COVERED YET: Calendly. Bookings, cancellations and reschedules are
 * Calendly's to own, and no argument so far has hinged on them — the money,
 * the agreement and the outcome are where every round has been fought. Said
 * here rather than left to be discovered.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readTracker, readPayments, LiveReadError } from "./lib/live-read.mjs";
import { readAllRecordings } from "./lib/fathom.mjs";
import { candidates, disagreements, moneyLines, STRENGTH } from "./lib/verify.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) {
    console.error(`\n✗ --${name} needs a value after it.`);
    process.exit(1);
  }
  return value;
}

function env() {
  const out = {};
  let raw;
  try {
    raw = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    console.error("\n✗ No .env.local. Copy .env.example and fill it in first.");
    process.exit(1);
  }
  for (const line of raw.split("\n")) {
    const i = line.indexOf("=");
    if (i === -1 || line.trimStart().startsWith("#")) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

const E = env();
const who = arg("who");
const email = arg("email");
const recordingId = arg("recording");
const since = arg("since") ?? "2026-08-01";

if (!who && !email && !recordingId) {
  console.error(
    "\n✗ Say who to look up.\n\n" +
      '  npm run verify -- --who "Brian"\n' +
      "  npm run verify -- --email someone@example.com\n" +
      "  npm run verify -- --recording 179884925\n\n" +
      "  --since 2026-08-01 bounds the recording search (default). Recordings are the\n" +
      "  slow part, so a tighter window is a faster answer.\n"
  );
  process.exit(1);
}

const label = who ?? email ?? `recording ${recordingId}`;
const money = (n) => `$${Number(n ?? 0).toLocaleString()}`;
const mark = (s) =>
  s === STRENGTH.email ? "by address" : s === STRENGTH.bothNames ? "by full name" : "by one name only";

console.log(`\nEverything the systems say about: ${label}\n${"─".repeat(60)}`);

/* ------------------------------------------------------------------ read */

let tracker = [];
let buyers = [];
try {
  tracker = await readTracker({ notionKey: E.NOTION_API_KEY, databaseId: E.NOTION_DATABASE_ID });
  const raw = await readPayments({ whopKey: E.WHOP_API_KEY });
  buyers = raw instanceof Map ? [...raw.values()] : raw;
} catch (err) {
  console.error(`\n✗ ${err.message}`);
  if (err instanceof LiveReadError && err.hint) console.error(`  ${err.hint}`);
  process.exit(1);
}

const recorders = Object.entries(E)
  .filter(([k, v]) => k.startsWith("FATHOM_KEY_") && v)
  .map(([k, v]) => ({ who: k.replace("FATHOM_KEY_", ""), key: v }));

const recordings = [];
const unread = [];
for (const r of recorders) {
  try {
    const items = await readAllRecordings(r.key, {
      createdAfter: `${since}T00:00:00Z`,
      params: { include_summary: "true", include_transcript: "true" },
    });
    for (const m of items) recordings.push({ ...m, recorder: r.who });
  } catch (err) {
    unread.push(`${r.who} (${err.message})`);
  }
}

/* --------------------------------------------------------------- match */

const trackerHits = candidates(tracker, { email, name: who }, {
  email: (r) => r.email,
  name: (r) => r.name,
});
const whopHits = candidates(buyers, { email, name: who }, {
  email: (b) => b.email,
  name: (b) => `${b.billing ?? ""} ${b.name ?? ""}`,
});

// A recording id is an identifier, so it wins outright when one was given.
const recordingHits = recordingId
  ? recordings
      .filter((m) => String(m.recording_id) === String(recordingId))
      .map((item) => ({ item, strength: STRENGTH.email }))
  : candidates(recordings, { email, name: who }, {
      email: (m) => (m.calendar_invitees ?? []).find((i) => i?.is_external && i.email)?.email ?? null,
      name: (m) => {
        const speakers = [...new Set((m.transcript ?? []).map((t) => t?.speaker?.display_name).filter(Boolean))];
        return `${m.title ?? ""} ${speakers.join(" ")}`;
      },
    });

/* --------------------------------------------------------------- print */

if (unread.length) {
  console.log(
    `\n⚠ Could not read ${unread.join(", ")}.\n  Anything below about what was AGREED or whether a call happened is incomplete.`
  );
}

console.log(`\n■ WHAT WAS AGREED — owned by the recording`);
if (recordingHits.length === 0) {
  console.log(
    `  No recording found since ${since}.\n` +
      `  Nothing owns this fact, so it cannot be confirmed from here. Whop can only\n` +
      `  tell you the floor — what has been paid — and the closer's word is the rest.`
  );
} else {
  for (const { item: m, strength } of recordingHits.slice(0, 4)) {
    const mins = Math.round((Date.parse(m.recording_end_time) - Date.parse(m.recording_start_time)) / 60000);
    const words = (m.transcript ?? []).reduce(
      (n, t) => n + String(t?.text ?? "").split(/\s+/).filter(Boolean).length,
      0
    );
    console.log(
      `\n  ${m.recording_start_time.slice(0, 10)}  ${mins}m  ${words} words  ${m.recorder}  (matched ${mark(strength)})`
    );
    console.log(`  "${m.title}"`);
    if (words < 50) console.log(`  ⚠ almost nothing was said — this is a no-show, not a call`);
    const lines = moneyLines(m.default_summary?.markdown_formatted);
    if (lines.length === 0) console.log(`  no money mentioned in the summary`);
    else for (const line of lines.slice(0, 8)) console.log(`    · ${line.slice(0, 150)}`);
    console.log(`  listen: ${m.share_url}`);
  }
}

console.log(`\n■ MONEY RECEIVED — owned by Whop`);
let whopPaid = 0;
if (whopHits.length === 0) {
  console.log(`  Nothing in Whop under this name or address.`);
} else {
  for (const { item: b, strength } of whopHits.slice(0, 6)) {
    console.log(
      `\n  ${b.billing || b.name} <${b.email}>  ${money(b.paid)} net` +
        `${b.refunded ? `, ${money(b.refunded)} refunded` : ""}  (matched ${mark(strength)})`
    );
    for (const h of b.history ?? []) console.log(`    ${h.day}  ${money(h.amount)}  ${h.reason ?? ""}`);
    // Only an address-matched buyer is counted. A name match is a hint, and
    // adding it to the total would put one person's money on another's row.
    if (strength === STRENGTH.email) whopPaid += b.paid;
  }
  const named = whopHits.filter((h) => h.strength !== STRENGTH.email).length;
  if (named > 0 && whopPaid === 0) {
    console.log(
      `\n  ⚠ Every one of those was matched on a NAME, so none is counted as this` +
        `\n    person's money. Confirm one and re-run with --email to get a total.`
    );
  }
}

console.log(`\n■ HOW THE CALL WENT — the tracker's reading, which owns nothing about money`);
if (trackerHits.length === 0) {
  console.log(`  No row on the tracker.`);
} else {
  for (const { item: r, strength } of trackerHits.slice(0, 6)) {
    console.log(
      `\n  ${r.date}  ${r.name}  (${r.closer})  ${r.outcome ?? "no outcome"}  (matched ${mark(strength)})`
    );
    console.log(
      `    deal ${r.priceClosed == null ? "—" : money(r.priceClosed)}` +
        `   typed as collected ${money(r.cash)}   on the call ${money(r.onCall)}`
    );
    console.log(`    ${r.url}`);
  }
  console.log(
    `\n  The closers' own sheets are not readable from here and own nothing either.` +
      `\n  If one disagrees with the above, that gap names a broken pipe, not a number.`
  );
}

const found = disagreements({
  trackerRows: trackerHits.filter((h) => h.strength === STRENGTH.email || h.strength === STRENGTH.bothNames).map((h) => h.item),
  whopPaid,
  recordingExists: recordingHits.length > 0,
});

console.log(`\n■ DISAGREEMENTS`);
if (found.length === 0) {
  console.log(`  None that these three sources can see.`);
} else {
  for (const d of found) {
    console.log(`\n  ${d.fact.toUpperCase()} — owned by ${d.owner}`);
    console.log(`    ${d.says}, but ${d.against}.`);
    console.log(`    ${d.note}`);
  }
}

console.log(
  `\n${"─".repeat(60)}\nOwnership: Whop owns money received. The recording owns what was agreed,` +
    `\nwhether anybody turned up, and which offer it was for. Calendly owns bookings` +
    `\nand is not read here. Full method: docs/verifying-a-number.md\n`
);
