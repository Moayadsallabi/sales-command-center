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
// duplicates. And this script asks the client's own workflow whether a meeting
// is a sales call, by running that workflow's filter expression, so meetings it
// would reject never get sent and never trip the untracked-call alert.
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

import {
  readSalesCallFilter,
  phraseListsIn,
  SalesCallFilterError,
} from "./lib/sales-call-filter.mjs";

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
    "--client needs the client handle, so the sales-call rule can be read from their workflow.",
    "Or pass --phrase once per phrase to filter on instead.",
  );
}
if (!Number.isFinite(days) || days <= 0) fail("--days must be a positive number.");

/**
 * The rule the client's workflow runs, or a hand-typed phrase list.
 *
 * The workflow's own filter is the default and should stay the default. It
 * blocks before it matches — "Funded Blueprint Onboarding Call" contains
 * "Funded Blueprint" — and a phrase list cannot express that, so --phrase is
 * an escape hatch for a client who has no generated workflow yet, not a
 * shortcut.
 */
function filterFor(handle, overrides) {
  if (overrides.length > 0) {
    const lower = overrides.map((p) => p.toLowerCase());
    return {
      source: `--phrase: ${overrides.map((p) => `"${p}"`).join(", ")}`,
      handTyped: true,
      // A hand-typed phrase list IS only about titles, so the body is ignored
      // here on purpose — the signature matches so callers need not care which
      // kind of filter they hold.
      isSalesCall: (title) => lower.some((p) => String(title ?? "").toLowerCase().includes(p)),
    };
  }
  try {
    const live = readSalesCallFilter(handle);
    const lists = phraseListsIn(live.expression);
    return {
      source: lists
        ? `${lists.sales.map((p) => `"${p}"`).join(", ")}` +
          (lists.blocked.length
            ? `\n              never: ${lists.blocked.map((b) => `"${b}"`).join(", ")}`
            : "")
        : live.expression,
      handTyped: false,
      isSalesCall: (title, body) => live.isSalesCall(title, body),
    };
  } catch (err) {
    if (err instanceof SalesCallFilterError) fail(err.message, err.hint);
    throw err;
  }
}

const filter = filterFor(client, phraseOverrides);

/* THE RULE IS ASKED WITH THE WHOLE RECORDING, NOT JUST ITS TITLE (2026-08-25).

   The live rule stopped being about titles alone on 2026-08-24: a call whose
   title names nothing is now accepted when it ran 15+ minutes AND somebody
   other than the closer speaks on it. readSalesCallFilter's own comment warns
   that handing it a title and an empty body "answers a question the rule no
   longer answers: every ad-hoc call comes back refused when the live workflow
   accepts it" — and that is exactly what this script was doing.

   The effect was that the ONE tool able to recover the backlog applied the old
   title-only rule to it. Brey's two Christian recordings came back "0 match
   the sales-call rule" hours after the workflow had been widened specifically
   to accept them, and 31 ad-hoc recordings stayed unrecoverable.

   check-dropped.mjs was cited here as already asking properly. It was not — it
   passed the transcript and withheld the summary, and was fixed the same day as
   this line. Nothing in this repo asks the rule a partial question any more. */
const isSalesCall = (meeting) =>
  filter.isSalesCall(titleOf(meeting), {
    meeting_title: titleOf(meeting),
    recording_start_time: meeting.recording_start_time,
    recording_end_time: meeting.recording_end_time,
    recorded_by: meeting.recorded_by,
    transcript: meeting.transcript,
    // AND THE SUMMARY, WHICH IS WHERE A DIFFERENT OFFER NAMES ITSELF (2026-09-05).
    // Already fetched above and simply not handed over, so the rule could never
    // refuse an FBA or JP Embrace call and the DRY RUN counted seven of them as
    // Funded Blueprint calls it was about to send. No wrong row ever reached the
    // tracker — the whole meeting object is posted, so the workflow re-applies
    // the rule with the summary attached and refuses them there. The cost was
    // worse than a wasted request: the preview is the thing a person reads
    // before deciding to write, and it was overstating what would land.
    default_summary: meeting.default_summary,
  });

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
console.log(`Sales calls: ${filter.source}`);
console.log(
  recordedBy.length > 0
    ? `Recorded by: ${recordedBy.join(", ")}`
    : "Recorded by: anyone this key can see",
);
if (filter.handTyped) {
  console.log(
    "  ⚠ --phrase replaces the workflow's rule with a plain contains-any list, so\n" +
      "    nothing is excluded. An onboarding call whose title carries a sales phrase\n" +
      "    will be sent and scored as a sale. Drop --phrase once the client has a\n" +
      "    generated workflow.",
  );
}
if (recordedBy.length === 0) {
  console.log(
    "  ⚠ Without --recorded-by this pulls every call the key can see, including\n" +
      "    other closers whose calls may already be on the tracker under no Recording ID.",
  );
}
console.log("");

const all = await fetchAll();
const sales = all
  .filter((m) => isSalesCall(m))
  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

console.log(`\n${all.length} meetings in the window, ${sales.length} match the sales-call rule.\n`);

if (sales.length === 0) {
  console.log("Nothing to send. If that is wrong, check how the invites were titled —");
  console.log(`the rule reads the title and nothing else: ${filter.source}`);
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
