// Puts a name on the call rows that arrived as "Unknown".
// Run with: npm run backfill:names [-- --apply]
//
// WHY ROWS ARRIVE NAMELESS
//
// The workflow reads the prospect's name off the calendar event Fathom was
// recording — the title, or failing that the external invitee. A closer who
// opens their own Google Meet room instead of joining the booked appointment
// leaves Fathom with no calendar event at all, so the title is "Impromptu
// Google Meet Meeting" and there is no invitee. Name and address both come
// back empty, and the row lands in the tracker as "Unknown" with nothing on it
// that any later join can use.
//
// On Brey's account on 27 August 2026 that was eleven of the fourteen nameless
// rows. The other three were titled after the offer with the name tacked on
// the end — "Profitability Game Plan Call with Kevin" — which the old title
// rule, looking only before a colon, could not see.
//
// WHERE THE NAME ACTUALLY IS
//
// In the room. Google Meet labels every participant, Fathom records that label
// on each line of the transcript, and the prospect is whoever spoke and is not
// one of ours. That is the person's own display name, not an inference about
// them, which is why it is the source this script uses.
//
// WHY NOT THE CALENDAR
//
// Because the calendar is wrong often enough to matter, and wrong invisibly.
// Matching an impromptu recording to whatever Calendly booking sits in the
// same half hour looked reasonable and failed the first time it was checked:
// the 31 July call is titled "with Kevin" and the transcript says Kevin Mizo,
// while the only nearby booking was Shelly's, cancelled. Three other slots had
// two to four candidate bookings. A wrong human's name on a row is worse than
// no name, because everything downstream then trusts it.
//
// So Calendly is used the other way round — as a second opinion. Where a
// booking in the same slot agrees with the transcript, that is said out loud;
// where it disagrees, the row is still written from the transcript and the
// disagreement is printed, because the transcript is the recording of what
// happened and the booking is only what was arranged.
//
// TWO RULES THAT NEVER BEND
//   - A row that already has a name is never touched.
//   - Two unaccounted speakers is not a name. Those rows are reported for a
//     human to rule on, never written.

import { loadEnv, NOTION_VERSION } from "./lib/notion-env.mjs";

const FATHOM_API = "https://api.fathom.ai/external/v1/meetings";
/** Notion allows roughly three writes a second. */
const WRITE_PAUSE_MS = 350;
/** Fathom rate-limits transcript reads hard, and answers 429 with an empty body. */
const FATHOM_PAGE_PAUSE_MS = 6000;
const FATHOM_RETRY_PAUSE_MS = 8000;
const FATHOM_MAX_PAGES = 40;
/** How far a booking may sit from the recording and still be worth comparing. */
const SLOT_WINDOW_MS = 45 * 60 * 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

loadEnv();

const applying = process.argv.includes("--apply");

const notionKey = process.env.NOTION_API_KEY;
const databaseId = process.env.NOTION_DATABASE_ID;
if (!notionKey || !databaseId) {
  fail(
    "NOTION_API_KEY and NOTION_DATABASE_ID are both needed.",
    "They are in .env.local. Run `npm run check:notion` first if that fails."
  );
}

/**
 * Every Fathom key this install has. A key only reaches its own owner's
 * recordings, so a client with two closers keeps one each as FATHOM_KEY_<name>.
 */
const fathomKeys = Object.entries(process.env)
  .filter(([name, value]) => value && (name === "FATHOM_API_KEY" || name.startsWith("FATHOM_KEY_")))
  .map(([name, value]) => ({ name, value }));

if (fathomKeys.length === 0) {
  fail(
    "No Fathom key is set, and the transcript is the only place these names exist.",
    "Set FATHOM_API_KEY, or one FATHOM_KEY_<closer> per closer, in .env.local."
  );
}

/* ------------------------------------------------------------------ Notion */

const notionHeaders = {
  Authorization: `Bearer ${notionKey}`,
  "Notion-Version": NOTION_VERSION,
  "Content-Type": "application/json",
};

const titleOf = (prop) => (prop?.title ?? []).map((t) => t.plain_text).join("").trim();
const selectOf = (prop) => prop?.select?.name ?? null;
const dateOf = (prop) => prop?.date?.start ?? null;
const urlOf = (prop) => prop?.url ?? null;
const numberOf = (prop) => (typeof prop?.number === "number" ? prop.number : null);

async function readTracker() {
  const rows = [];
  let cursor;
  for (;;) {
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: notionHeaders,
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
    });
    const body = await res.json();
    if (!res.ok) fail(`Notion refused the read (${res.status}).`, JSON.stringify(body).slice(0, 200));
    rows.push(...(body.results ?? []));
    if (!body.has_more) return rows;
    cursor = body.next_cursor;
  }
}

/* ------------------------------------------------------------------ Fathom */

/**
 * Every recording both keys can see, with transcripts.
 *
 * Paced rather than parallel: transcripts are the expensive read and Fathom
 * answers a rate-limited request with a 429 and an empty body, which parses as
 * a syntax error rather than as "slow down" unless it is handled here.
 */
async function readRecordings(wanted) {
  const found = new Map();
  for (const key of fathomKeys) {
    let cursor = null;
    for (let page = 0; page < FATHOM_MAX_PAGES; page++) {
      const url = new URL(FATHOM_API);
      url.searchParams.set("include_transcript", "true");
      if (cursor) url.searchParams.set("cursor", cursor);

      let payload = null;
      for (let attempt = 0; attempt < 8; attempt++) {
        const res = await fetch(url, { headers: { "X-Api-Key": key.value } });
        const text = await res.text();
        if (res.status === 429 || (res.ok && !text.trim())) {
          await sleep(FATHOM_RETRY_PAUSE_MS);
          continue;
        }
        if (!res.ok) {
          console.error(`  ! ${key.name}: Fathom answered ${res.status} — ${text.slice(0, 120)}`);
          break;
        }
        try {
          payload = JSON.parse(text);
        } catch {
          await sleep(FATHOM_RETRY_PAUSE_MS);
          continue;
        }
        break;
      }
      if (!payload) break;

      for (const meeting of payload.items ?? []) {
        if (meeting.share_url) found.set(String(meeting.share_url), meeting);
        if (meeting.recording_id != null) found.set(`id:${meeting.recording_id}`, meeting);
      }
      // Stop as soon as every row we came for is in hand, rather than reading
      // a year of recordings to fill fourteen rows.
      if (wanted.every((w) => found.has(w))) return found;

      cursor = payload.next_cursor ?? null;
      if (!cursor) break;
      await sleep(FATHOM_PAGE_PAUSE_MS);
    }
  }
  return found;
}

/* ---------------------------------------------------------------- Calendly */

/** Bookings in the window, for the second opinion only. Absent is fine. */
async function readBookings(from, to) {
  const token = process.env.CALENDLY_API_KEY;
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}` };

  const me = await fetch("https://api.calendly.com/users/me", { headers });
  if (!me.ok) return null;
  const organization = (await me.json()).resource?.current_organization;
  if (!organization) return null;

  const events = [];
  for (const status of ["active", "canceled"]) {
    let next = null;
    do {
      const url = next ? new URL(next) : new URL("https://api.calendly.com/scheduled_events");
      if (!next) {
        url.searchParams.set("organization", organization);
        url.searchParams.set("status", status);
        url.searchParams.set("min_start_time", from);
        url.searchParams.set("max_start_time", to);
        url.searchParams.set("count", "100");
      }
      const res = await fetch(url, { headers });
      if (!res.ok) return events.length ? events : null;
      const body = await res.json();
      events.push(...(body.collection ?? []).map((e) => ({ ...e, status })));
      next = body.pagination?.next_page ?? null;
    } while (next);
  }
  return events;
}

async function inviteesFor(eventUri, token) {
  const res = await fetch(`https://api.calendly.com${new URL(eventUri).pathname}/invitees?count=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return ((await res.json()).collection ?? []).map((i) => ({ name: i.name?.trim() ?? "", email: i.email ?? "" }));
}

/* ------------------------------------------------------------------- names */

const NOT_A_NAME = new Set(["", "unknown", "no name", "n/a"]);
const needsName = (name) => NOT_A_NAME.has(name.toLowerCase());
const key = (name) => String(name).trim().toLowerCase();

/**
 * The one person in the room who is not us.
 *
 * Everyone on our side is excluded by every name we hold for them — the closer
 * as the tracker recorded it, the internal invitees, and whoever hit record —
 * because a call named after its own closer is the one wrong answer that would
 * look right in the table.
 */
function prospectFrom(meeting, closer) {
  const ours = new Set(
    [
      closer,
      meeting.recorded_by?.name,
      ...(meeting.calendar_invitees ?? []).filter((i) => i && !i.is_external).map((i) => i.name),
    ]
      .filter(Boolean)
      .map(key)
  );

  const speakers = [];
  for (const line of meeting.transcript ?? []) {
    const said = String(line?.speaker?.display_name ?? "").trim();
    if (said && !ours.has(key(said)) && !speakers.some((s) => key(s) === key(said))) speakers.push(said);
  }
  return speakers;
}

/** Whether two names are plainly the same person written two ways. */
function agrees(a, b) {
  const x = key(a).replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  const y = key(b).replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
  if (!x.length || !y.length) return false;
  return x.some((part) => y.includes(part));
}

/* -------------------------------------------------------------------- main */

console.log(`\nReading the tracker…`);
const rows = await readTracker();
const nameless = rows.filter((r) => needsName(titleOf(r.properties.Name)));

console.log(`  ${rows.length} call rows, ${nameless.length} with no name on them.`);
if (nameless.length === 0) {
  console.log(`\nNothing to fill in.\n`);
  process.exit(0);
}

const wanted = nameless.map((r) => {
  const share = urlOf(r.properties["Recording URL"]);
  const id = numberOf(r.properties["Recording ID"]);
  return share ? String(share) : id != null ? `id:${id}` : "";
});

console.log(`Reading transcripts from Fathom (paced — this takes a minute)…`);
const recordings = await readRecordings(wanted.filter(Boolean));
console.log(`  ${recordings.size / 2 | 0} recordings in hand.`);

const dates = nameless.map((r) => dateOf(r.properties["Call Date"])).filter(Boolean).sort();
const bookings = dates.length
  ? await readBookings(
      new Date(`${dates[0]}T00:00:00Z`).toISOString(),
      new Date(new Date(`${dates[dates.length - 1]}T00:00:00Z`).getTime() + 2 * 864e5).toISOString()
    )
  : null;
if (bookings) console.log(`  ${bookings.length} Calendly bookings, for the second opinion.`);
else console.log(`  Calendly not read — the transcript stands on its own.`);

const ready = [];
const held = [];

for (const row of nameless) {
  const when = dateOf(row.properties["Call Date"]);
  const closer = selectOf(row.properties.Closer) ?? "";
  const share = urlOf(row.properties["Recording URL"]);
  const id = numberOf(row.properties["Recording ID"]);
  const meeting = recordings.get(String(share)) ?? (id != null ? recordings.get(`id:${id}`) : null);
  const label = `${when ?? "no date"}  ${closer || "no closer"}`;

  if (!meeting) {
    held.push({ label, why: "no Fathom recording matched this row's link or recording id" });
    continue;
  }
  const speakers = prospectFrom(meeting, closer);
  if (speakers.length === 0) {
    held.push({ label, why: `nobody but our own side spoke on "${meeting.title}"` });
    continue;
  }
  if (speakers.length > 1) {
    held.push({
      label,
      why: `${speakers.length} people in the room who are not ours (${speakers.join(", ")}) — which one is the prospect is a guess`,
    });
    continue;
  }

  const name = speakers[0];
  let second = null;
  if (bookings && meeting.recording_start_time) {
    const at = Date.parse(meeting.recording_start_time);
    const near = bookings.filter((e) => Math.abs(Date.parse(e.start_time) - at) <= SLOT_WINDOW_MS);
    const invited = [];
    for (const event of near) invited.push(...(await inviteesFor(event.uri, process.env.CALENDLY_API_KEY)));
    if (invited.some((i) => agrees(i.name, name))) second = "Calendly agrees";
    else if (invited.length) second = `Calendly's booking in that slot says ${invited.map((i) => i.name).join(" / ")}`;
  }

  ready.push({ row, label, name, title: meeting.title, second });
}

console.log(`\n${ready.length} row${ready.length === 1 ? "" : "s"} the transcript names:\n`);
for (const item of ready) {
  console.log(`  ${item.label.padEnd(28)} → ${item.name}`);
  console.log(`  ${"".padEnd(28)}   from "${item.title}"${item.second ? ` · ${item.second}` : ""}`);
}

if (held.length) {
  console.log(`\n${held.length} left alone, for someone to rule on:\n`);
  for (const item of held) console.log(`  ${item.label.padEnd(28)} ${item.why}`);
}

if (!applying) {
  console.log(
    `\nNothing has been written. Rerun with \`npm run backfill:names -- --apply\`` +
      ` to write ${ready.length} name${ready.length === 1 ? "" : "s"} into Notion.\n`
  );
  process.exit(0);
}
if (ready.length === 0) {
  console.log(`\nNothing to write.\n`);
  process.exit(0);
}

console.log(`\nWriting to Notion:\n`);
let written = 0;
for (const item of ready) {
  const res = await fetch(`https://api.notion.com/v1/pages/${item.row.id}`, {
    method: "PATCH",
    headers: notionHeaders,
    body: JSON.stringify({ properties: { Name: { title: [{ text: { content: item.name } }] } } }),
  });
  if (!res.ok) {
    console.error(`  ✗ ${item.label}: Notion refused the edit (${res.status}) ${(await res.text()).slice(0, 120)}`);
  } else {
    console.log(`  ✓ ${item.label.padEnd(28)} → ${item.name}`);
    written++;
  }
  await sleep(WRITE_PAUSE_MS);
}

console.log(
  `\n${written} row${written === 1 ? "" : "s"} named. Notion's page history is the undo.\n` +
    `These rows still carry no address. \`npm run backfill:emails\` can now reach them:\n` +
    `it ties a call to its booking on the name and the day, which needs the name.\n`
);
