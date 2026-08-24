#!/usr/bin/env node
/**
 * Every recording the automation refused, and whether anybody rescued it.
 *
 * WHY THIS EXISTS. A call reaches the tracker only if its meeting TITLE names
 * it — "Alan: Profitability Game Plan Call" passes, and the same call started
 * in a bare Meet room is titled "Impromptu Google Meet Meeting" and is
 * rejected. Every rejection posts to Slack with a one-click link to score it by
 * hand, so on paper nothing is lost.
 *
 * On 2026-08-24 that queue was measured for the first time: across August it
 * had asked for 29 rulings and been given 3. Both of Christian's calls were in
 * it, unactioned, which is why a whole closer was missing from the dashboard
 * while the alert that should have caught it was working perfectly.
 *
 * A queue nobody works is not a safety net, and a Slack channel cannot tell you
 * how long its backlog is. This can: it reads the recorders and the tracker
 * directly and prints what fell down the gap, oldest first, with the rescue
 * link for each. Run it weekly, and before anything client-facing.
 *
 *   npm run check:dropped -- --client brey [--since 2026-08-01]
 *
 * It changes nothing. It only tells you what is missing.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { readSalesCallFilter, phraseListsIn } from "./lib/sales-call-filter.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) {
    console.error(`\n✗ --${name} needs a value after it.`);
    process.exit(1);
  }
  return value;
}

/** .env.local, read the same way the dashboard reads it. */
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
const CLIENT = arg("client", "brey");
const SINCE = arg("since", new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
const N8N_BASE = (E.N8N_BASE_URL ?? "https://moayad.app.n8n.cloud").replace(/\/$/, "");

/**
 * The recorder keys, one per closer.
 *
 * Named FATHOM_KEY_<CLOSER> so adding a closer is adding a line to .env.local
 * rather than editing this file — the last time a closer went missing, nobody
 * could tell whether he had stopped recording or was never being read.
 */
const RECORDERS = Object.entries(E)
  .filter(([k, v]) => k.startsWith("FATHOM_KEY_") && v)
  .map(([k, v]) => ({ who: k.replace("FATHOM_KEY_", ""), key: v }));

if (RECORDERS.length === 0) {
  console.error("\n✗ No FATHOM_KEY_* in .env.local, so there is nothing to compare against.");
  process.exit(1);
}

async function recordings(key) {
  const out = [];
  let cursor;
  for (;;) {
    const url = new URL("https://api.fathom.ai/external/v1/meetings");
    url.searchParams.set("created_after", `${SINCE}T00:00:00Z`);
    // The transcript is what makes an impromptu call readable at all. It has no
    // calendar invite, so "was there an outsider on it" can only be answered by
    // whether a second voice speaks — which is exactly the case this list is
    // for. Heavy, and worth it on a weekly command.
    url.searchParams.set("include_transcript", "true");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { "X-Api-Key": key } });
    if (!res.ok) {
      throw new Error(`Fathom refused (${res.status}). A key only reaches its own owner's recordings.`);
    }
    const data = await res.json();
    out.push(...(data.items ?? []));
    cursor = data.next_cursor;
    if (!cursor) break;
  }
  return out;
}

/** Every recording link already on the tracker, so a rescue is visible as one. */
async function trackedShareIds() {
  const ids = new Set();
  let cursor;
  do {
    const res = await fetch(
      `https://api.notion.com/v1/databases/${E.NOTION_DATABASE_ID}/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${E.NOTION_API_KEY}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      }
    );
    if (!res.ok) throw new Error(`Notion refused (${res.status}): ${await res.text()}`);
    const data = await res.json();
    for (const page of data.results ?? []) {
      const url = page.properties?.["Recording URL"]?.url ?? "";
      const id = String(url).split("/share/")[1];
      if (id) ids.add(id);
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return ids;
}

const minutes = (m) =>
  Math.round((Date.parse(m.recording_end_time) - Date.parse(m.recording_start_time)) / 60000);

/**
 * How likely it is that a dropped recording was a real sales call.
 *
 * Deliberately not a verdict, and deliberately not automatic. It sorts the
 * backlog so the 70-minute call with an outsider on it is read before the
 * four-minute one, because a list of thirty is only worked if the top of it
 * pays.
 */
function looksLikeASalesCall(m, refusal) {
  const long = minutes(m) >= 15;
  const outsider = (m.calendar_invitees ?? []).some((i) => i.is_external);
  const speakers = new Set(
    (m.transcript ?? []).map((t) => t?.speaker?.display_name).filter(Boolean)
  );
  const host = m.recorded_by?.name;
  const otherVoice = [...speakers].some((s) => s !== host);
  // A call refused by NAME is never promoted, however long it ran and whoever
  // was on it. The first version of this scored on length and outsiders alone
  // and put two 65-minute "Team Meeting" recordings at the top of the queue —
  // the two calls the block list exists to reject, recommended hardest. Length
  // and an outsider are what a team meeting looks like too.
  const score = refusal === "blocked-by-name"
    ? -1
    : (long ? 2 : 0) + (outsider ? 2 : 0) + (otherVoice ? 1 : 0);
  return { long, outsider, otherVoice, score };
}

/**
 * Why this recording was refused — the two are not the same queue.
 *
 * "blocked-by-name" means somebody wrote "onboarding" or "team meeting" into
 * the block list on purpose, and the rule did what it was told. Those want
 * listing, so a mis-named sales call is still findable, but never ranking.
 *
 * "no-phrase-matched" is the real backlog: a call whose title simply says
 * nothing, which is every impromptu recording ever made.
 */
function refusalKind(title, blockedPhrases) {
  const t = String(title ?? "").toLowerCase();
  return blockedPhrases.some((b) => t.includes(b)) ? "blocked-by-name" : "no-phrase-matched";
}

const filter = readSalesCallFilter(CLIENT);
const BLOCKED_PHRASES = phraseListsIn(filter.expression)?.blocked ?? [];

console.log(`\nRecordings since ${SINCE}, against the rule ${CLIENT}'s workflow is actually running.\n`);

const tracked = await trackedShareIds();
const dropped = [];
let totalPassed = 0;
let totalBlocked = 0;
let rescued = 0;

for (const { who, key } of RECORDERS) {
  let items;
  try {
    items = await recordings(key);
  } catch (err) {
    console.log(`  ${who}: could not be read — ${err.message}`);
    continue;
  }
  let passed = 0;
  let blocked = 0;
  let blockedAndRescued = 0;
  for (const m of items) {
    const shareId = String(m.share_url ?? "").split("/share/")[1];
    const onTracker = shareId ? tracked.has(shareId) : false;
    if (filter.isSalesCall(String(m.title ?? ""), {})) {
      passed += 1;
      continue;
    }
    blocked += 1;
    if (onTracker) blockedAndRescued += 1;
    else dropped.push({ who, m, refusal: refusalKind(m.title, BLOCKED_PHRASES) });
  }
  totalPassed += passed;
  totalBlocked += blocked;
  rescued += blockedAndRescued;
  console.log(
    `  ${who.padEnd(10)} ${String(items.length).padStart(3)} recordings — ` +
      `${passed} scored by title, ${blocked} blocked (${blockedAndRescued} rescued by hand)`
  );
}

console.log(
  `\n  ${totalPassed} passed the title rule, ${totalBlocked} were blocked, ` +
    `${rescued} of those were rescued.`
);

if (dropped.length === 0) {
  console.log("\nNothing is sitting in the gap. Every blocked recording was ruled on.\n");
  process.exit(0);
}

// Oldest first: the backlog is worked from the end that has been waiting longest,
// and a queue printed newest-first hides exactly the calls that have rotted.
dropped.sort((a, b) => a.m.recording_start_time.localeCompare(b.m.recording_start_time));

const queue = dropped.filter((d) => d.refusal === "no-phrase-matched");
const onPurpose = dropped.filter((d) => d.refusal === "blocked-by-name");

function line({ who, m, refusal }) {
  const s = looksLikeASalesCall(m, refusal);
  const marks = [
    s.long ? `${minutes(m)}m` : `${minutes(m)}m short`,
    s.outsider ? "outsider on the invite" : null,
    s.otherVoice ? "another voice on the call" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const flag = s.score >= 4 ? "!!" : s.score >= 2 ? " ·" : "  ";
  console.log(`${flag} ${m.recording_start_time.slice(0, 10)}  ${who.padEnd(10)} "${m.title}"`);
  console.log(`     ${marks}`);
  console.log(`     ${m.share_url}`);
  console.log(`     score it: ${N8N_BASE}/form/score-call-${CLIENT}?recording=${m.recording_id}`);
  console.log("");
}

console.log(
  `\n${queue.length} recording(s) had a title that named nothing, and nobody ruled\n` +
    `on them. This is the backlog. Each line ends with the link that scores it.\n`
);
queue.forEach(line);

console.log(
  `Lines marked !! ran past fifteen minutes AND had someone from outside on\n` +
    `them, which is what a sales call looks like from here. Nothing above has\n` +
    `been changed — this only reads. Scoring one is a click on its own link.\n`
);

if (onPurpose.length > 0) {
  console.log(
    `\n${onPurpose.length} more were refused BY NAME — their titles contain ` +
      `${BLOCKED_PHRASES.map((b) => `"${b}"`).join(", ")}.\n` +
      `That is the rule working, not a backlog, so none of them are ranked. They\n` +
      `are listed only in case a sales call was given one of those names by mistake.\n`
  );
  onPurpose.forEach(line);
}
