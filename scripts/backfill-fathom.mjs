// Replays a closer's past Fathom calls through the live n8n workflow, so calls
// recorded before they were connected get scored like any other.
//
// The webhook only fires on new recordings and never looks backwards, so
// history has to be fetched from the Fathom API and posted in. What makes that
// safe is that the API's meeting object and the webhook's payload are the same
// shape — same field names, same nesting — so each meeting is posted verbatim
// as the request body and every expression, filter and retry downstream runs
// exactly as it does on a live call. Nothing here reimplements the pipeline.
//
// Two things stop a replay doing damage. The workflow queries Notion for the
// Recording ID before it reaches the scoring step, so a call already on the
// tracker costs one lookup and stops — re-running is free and creates no
// duplicates. And this script filters on the same call-title phrases the
// workflow does, read out of that client's generated workflow rather than
// retyped here, so meetings it would reject never get sent and never trip the
// untracked-call alert.
//
// The key is read from the environment and never from an argument, so it stays
// out of shell history and out of the process list.
//
//   export FATHOM_API_KEY=...
//   npm run backfill:fathom -- \
//     --client brey \
//     --webhook https://example.app.n8n.cloud/webhook/fathom-webhook-brey \
//     --recorded-by closer@theirdomain.com \
//     --days 60
//
// That prints what it would send and stops. Add --apply to send it.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.fathom.ai/external/v1/meetings";

/** The workflow logs a call as a no-show below this, rather than scoring it. */
const MIN_TRANSCRIPT_WORDS = 50;

function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) fail(`--${name} needs a value after it.`);
  return value;
}

/** Every value passed for a repeatable option, in the order given. */
function argAll(name) {
  const values = [];
  process.argv.forEach((a, i) => {
    if (a !== `--${name}`) return;
    const value = process.argv[i + 1];
    if (!value || value.startsWith("--")) fail(`--${name} needs a value after it.`);
    values.push(value);
  });
  return values;
}

const key = process.env.FATHOM_API_KEY;
const client = arg("client");
const webhook = arg("webhook");
const days = Number(arg("days") ?? 60);
const recordedBy = argAll("recorded-by");
const phraseOverrides = argAll("phrase");
const apply = process.argv.includes("--apply");
const delayMs = Number(arg("delay") ?? 1500);

if (!key) {
  fail(
    "FATHOM_API_KEY is not set.",
    "Set it in this terminal first: export FATHOM_API_KEY=... — the key decides whose calls come back.",
  );
}
if (!webhook) fail("--webhook needs the client's production webhook URL.");
if (!client && phraseOverrides.length === 0) {
  fail(
    "--client needs the client handle, so the call phrases can be read from their workflow.",
    "Or pass --phrase once per phrase to filter on instead.",
  );
}
if (!Number.isFinite(days) || days <= 0) fail("--days must be a positive number.");

/**
 * The phrases the client's workflow accepts, read from the workflow itself so
 * this can never filter on a list that has drifted from what n8n will take.
 */
function phrasesFor(handle) {
  const path = join(ROOT, "automation", "generated", `sales-call-tracker-${handle}.json`);
  let workflow;
  try {
    workflow = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(
      `No generated workflow for "${handle}" at ${path}.`,
      "Run configure:client for them first, or pass --phrase to filter by hand.",
    );
  }
  const node = workflow.nodes.find((n) => n.name === "Is Sales Call?");
  const conditions = node?.parameters?.conditions?.conditions ?? [];
  const phrases = conditions.map((c) => c.rightValue).filter(Boolean);
  if (phrases.length === 0) fail(`Found no call phrases in ${path}.`);
  return phrases;
}

const phrases = phraseOverrides.length > 0 ? phraseOverrides : phrasesFor(client);

/** The same test the workflow's Is Sales Call? node makes: contains, any, case-insensitive. */
function isSalesCall(title) {
  const t = String(title ?? "").toLowerCase();
  return phrases.some((p) => t.includes(p.toLowerCase()));
}

function titleOf(meeting) {
  return meeting.meeting_title ?? meeting.title ?? "";
}

function wordCount(meeting) {
  return (meeting.transcript ?? [])
    .map((t) => t.text ?? "")
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function prospectOf(meeting) {
  const title = titleOf(meeting);
  const i = title.indexOf(":");
  if (i > 0 && title.slice(0, i).trim()) return title.slice(0, i).trim();
  const external = (meeting.calendar_invitees ?? []).find((x) => x?.is_external && x.name);
  return external ? String(external.name).trim() : "Unknown";
}

function minutesOf(meeting) {
  const start = new Date(meeting.recording_start_time).getTime();
  const end = new Date(meeting.recording_end_time).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / 60000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One page of meetings, retrying once on a rate limit rather than dropping it. */
async function getPage(cursor) {
  const url = new URL(API);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  url.searchParams.set("created_after", since);
  url.searchParams.set("include_transcript", "true");
  url.searchParams.set("include_summary", "true");
  recordedBy.forEach((email) => url.searchParams.append("recorded_by[]", email));
  if (cursor) url.searchParams.set("cursor", cursor);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(url, { headers: { "X-Api-Key": key } });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 5) * 1000;
      console.log(`  rate limited, waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      fail(
        `Fathom rejected the key (${res.status}).`,
        "A key only reaches its owner's recordings and anything shared with them or their team.",
      );
    }
    if (!res.ok) fail(`Fathom returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
  fail("Still rate limited after three attempts. Try again in a few minutes.");
}

async function fetchAll() {
  const meetings = [];
  let cursor = null;
  let page = 0;
  do {
    page += 1;
    const body = await getPage(cursor);
    const items = body.items ?? [];
    meetings.push(...items);
    cursor = body.next_cursor ?? null;
    console.log(`  page ${page}: ${items.length} meetings${cursor ? "" : " (last)"}`);
  } while (cursor);
  return meetings;
}

console.log(`\nFathom backfill — last ${days} days`);
console.log(`Call phrases: ${phrases.map((p) => `"${p}"`).join(", ")}`);
console.log(
  recordedBy.length > 0
    ? `Recorded by: ${recordedBy.join(", ")}`
    : "Recorded by: anyone this key can see",
);
if (recordedBy.length === 0) {
  console.log(
    "  ⚠ Without --recorded-by this pulls every call the key can see, including\n" +
      "    other closers whose calls may already be on the tracker under no Recording ID.",
  );
}
console.log("");

const all = await fetchAll();
const sales = all
  .filter((m) => isSalesCall(titleOf(m)))
  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

console.log(`\n${all.length} meetings in the window, ${sales.length} match the call phrases.\n`);

if (sales.length === 0) {
  console.log("Nothing to send. If that is wrong, check how the invites were titled —");
  console.log(`the phrase has to appear in the title: ${phrases.map((p) => `"${p}"`).join(", ")}`);
  process.exit(0);
}

let willScore = 0;
let noShow = 0;
let noEmail = 0;

for (const m of sales) {
  const words = wordCount(m);
  const scored = words >= MIN_TRANSCRIPT_WORDS;
  const email = (m.calendar_invitees ?? []).find((x) => x?.is_external && x.email)?.email ?? "";
  if (scored) willScore += 1;
  else noShow += 1;
  if (!email) noEmail += 1;

  const flags = [scored ? `${words} words` : `${words} words → No show`, email || "no prospect email"];
  console.log(
    `  ${m.created_at.slice(0, 10)}  ${prospectOf(m).padEnd(22)} ${String(minutesOf(m)).padStart(3)}m  ` +
      `${(m.recorded_by?.name ?? "?").padEnd(18)} ${flags.join(" · ")}`,
  );
}

console.log(`\n${willScore} will be scored, ${noShow} logged as no-shows.`);
if (noEmail > 0) {
  console.log(
    `${noEmail} have no external invitee, so they score but cannot be tied to a lead automatically.`,
  );
}
console.log("Calls already on the tracker are dropped by the workflow before scoring, at no cost.");

if (!apply) {
  console.log("\nDry run — nothing sent. Re-run with --apply to send these.\n");
  process.exit(0);
}

console.log(`\nSending to ${webhook}, oldest first, ${delayMs}ms apart.\n`);

let sent = 0;
let failed = 0;

for (const m of sales) {
  const label = `${m.created_at.slice(0, 10)} ${prospectOf(m)}`;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(m),
    });
    if (res.ok) {
      sent += 1;
      console.log(`  → ${label}`);
    } else {
      failed += 1;
      console.log(`  ✗ ${label} — n8n returned ${res.status}`);
    }
  } catch (err) {
    failed += 1;
    console.log(`  ✗ ${label} — ${err.message}`);
  }
  await sleep(delayMs);
}

console.log(`\n${sent} accepted by n8n, ${failed} rejected at the door.`);
console.log(
  "Accepted is not scored. The workflow replies before it does any work, so these\n" +
    "counts say nothing about what reaches Notion — scoring can still fail afterwards,\n" +
    "most often on an empty Anthropic credit balance, which surfaces as a generic 400.",
);
console.log("Check n8n's execution list for the real outcome, and the error-alert channel for failures.");
console.log("Re-running is safe: anything already on the tracker is skipped before it costs anything.\n");
