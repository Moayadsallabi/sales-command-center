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
import { NOTION_VERSION } from "./lib/notion-env.mjs";
import { readAllRecordings } from "./lib/fathom.mjs";

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
/**
 * `--share` prints the backlog as something you can paste to the client's team.
 *
 * The default output is for whoever runs this: counts, the deliberate blocks,
 * the reasoning. None of that helps a closer who has been handed twenty links
 * and asked to sort them out — it just buries the only thing they need, which
 * is one line and one link per call.
 */
const SHARE = process.argv.includes("--share");
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

function recordings(key) {
  return readAllRecordings(key, {
    createdAfter: `${SINCE}T00:00:00Z`,
    params: {
      // The transcript is what makes an impromptu call readable at all. It has
      // no calendar invite, so "was there an outsider on it" can only be
      // answered by whether a second voice speaks — which is exactly the case
      // this list is for. Heavy, and worth it on a weekly command.
      include_transcript: "true",
      /* THE SUMMARY IS PART OF THE RULE, SO IT HAS TO BE FETCHED (2026-09-05).
         The live rule refuses a call whose "Meeting Purpose" names a different
         offer — fba, amazon, jp embrace — and that purpose is only in
         `default_summary`, which this was not asking for. Without it the rule
         cannot refuse, so every one of the other offer's calls came back
         "accepted" and was printed here as a Funded Blueprint call somebody had
         forgotten to score, under a link that files it on THIS client's
         tracker. Measured on Brey the same day: 30 of the 51 calls this queue
         was recommending were somebody else's business.
         check-delivery.mjs carries the same lesson about the transcript and
         calls itself "the THIRD caller found doing it". This is the fourth, one
         field along: passing part of the recording asks a question the rule
         does not answer, and the answer it gives back is confidently wrong. */
      include_summary: "true",
    },
  });
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
          "Notion-Version": NOTION_VERSION,
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
  const score = refusal === "blocked-by-name" || refusal === "blocked-by-offer"
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
function refusalKind(m, blockedPhrases) {
  const t = String(m.title ?? "").toLowerCase();
  if (blockedPhrases.some((b) => t.includes(b))) return "blocked-by-name";
  // "blocked-by-offer" is the rule working, exactly like a blocked name — the
  // call happened and was real, it was simply somebody else's business. It is
  // listed so a mis-summarised call is still findable, and never ranked,
  // because a link that files another offer's call on this client's tracker is
  // the one outcome this command must not encourage.
  if (refusedForAnotherOffer(m)) return "blocked-by-offer";
  return "no-phrase-matched";
}

const filter = readSalesCallFilter(CLIENT);
const BLOCKED_PHRASES = phraseListsIn(filter.expression)?.blocked ?? [];

/**
 * What the live rule would do with this recording, asked properly.
 *
 * The rule stopped being about titles alone, so handing it a title and an
 * empty body now answers a question nobody asked: it says "refused" for every
 * ad-hoc call, including the ones the workflow accepts on evidence. Give it
 * the same shape the webhook does.
 */
function wouldPass(m) {
  return filter.isSalesCall(String(m.title ?? ""), {
    meeting_title: m.title,
    recording_start_time: m.recording_start_time,
    recording_end_time: m.recording_end_time,
    recorded_by: m.recorded_by,
    transcript: m.transcript,
    default_summary: m.default_summary,
  });
}

/** What the recording says it was for. Shown, never decided with. */
function purposeOf(m) {
  const sum = String(m.default_summary?.markdown_formatted ?? "");
  return (sum.match(/Meeting Purpose\s*\[([^\]]{0,240})/i)?.[1] ?? "").trim() || null;
}

/**
 * Was it the SUMMARY that refused this, rather than the title or the length?
 *
 * Asked by running the shipped rule twice — once with the summary and once
 * without — rather than by restating its list of other offers here. The list
 * lives in the client's workflow and changes there; a copy in this file would
 * agree with it until the day somebody added an offer.
 */
function refusedForAnotherOffer(m) {
  const base = {
    meeting_title: m.title,
    recording_start_time: m.recording_start_time,
    recording_end_time: m.recording_end_time,
    recorded_by: m.recorded_by,
    transcript: m.transcript,
  };
  return (
    filter.isSalesCall(String(m.title ?? ""), base) &&
    !filter.isSalesCall(String(m.title ?? ""), { ...base, default_summary: m.default_summary })
  );
}

console.log(`\nRecordings since ${SINCE}, against the rule ${CLIENT}'s workflow is actually running.\n`);

const tracked = await trackedShareIds();
const dropped = [];
let totalPassed = 0;
let totalBlocked = 0;
let rescued = 0;

const unread = [];
for (const { who, key } of RECORDERS) {
  let items;
  try {
    items = await recordings(key);
  } catch (err) {
    console.log(`  ${who}: could not be read — ${err.message}`);
    unread.push(who);
    continue;
  }
  let passed = 0;
  let blocked = 0;
  let blockedAndRescued = 0;
  for (const m of items) {
    const shareId = String(m.share_url ?? "").split("/share/")[1];
    const onTracker = shareId ? tracked.has(shareId) : false;

    // THE QUESTION IS "IS IT ON THE TRACKER", NOT "WOULD THE RULE TAKE IT".
    //
    // Those came apart the moment the rule started judging recordings instead
    // of titles. A recording rejected last week is still missing today even if
    // today's rule would have accepted it — it was refused once and nothing
    // re-sends it. Deciding membership by the current rule would have quietly
    // emptied this list of the exact calls it was built to surface.
    if (onTracker) {
      if (wouldPass(m)) passed += 1;
      else {
        blocked += 1;
        blockedAndRescued += 1;
      }
      continue;
    }
    if (wouldPass(m)) {
      // Not refused by the rule, and still not there. A different fault —
      // worth seeing, and it still needs scoring by hand.
      dropped.push({ who, m, refusal: "accepted-but-absent" });
    } else {
      blocked += 1;
      dropped.push({ who, m, refusal: refusalKind(m, BLOCKED_PHRASES) });
    }
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

// Everything that is missing and was not refused on purpose. Both remaining
// kinds need the same thing from a person — a recording the rule turned away,
// and one it would take today but that was refused before the rule changed.
// Splitting them here once cost the list every call it existed to show.
const deliberate = new Set(["blocked-by-name", "blocked-by-offer"]);
const queue = dropped.filter((d) => !deliberate.has(d.refusal));
const onPurpose = dropped.filter((d) => d.refusal === "blocked-by-name");
const otherOffer = dropped.filter((d) => d.refusal === "blocked-by-offer");

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
  // An ad-hoc title says nothing, so without this every line reads the same and
  // the only way to sort a backlog is to open all of it.
  const purpose = purposeOf(m);
  if (purpose) console.log(`     ${purpose.slice(0, 100)}`);
  console.log(`     ${m.share_url}`);
  console.log(`     score it: ${N8N_BASE}/form/score-call-${CLIENT}?recording=${m.recording_id}`);
  console.log("");
}

// A SHORT LIST AND A COMPLETE LIST LOOK IDENTICAL once they leave here.
//
// The recorder rate-limits in bursts, and the first version of this printed its
// totals regardless — one run reported a backlog of two when the real number
// was twenty-nine, because one closer's read had failed four lines above. That
// is survivable for whoever ran it and not survivable once it has been sent to
// a client's team, who have no way to tell.
if (unread.length > 0) {
  console.error(
    `\n✗ ${unread.join(" and ")} could not be read, so this list is INCOMPLETE.\n` +
      `  Nothing has been printed for sharing. Wait a minute and run it again —\n` +
      `  the recorder rate-limits in bursts and usually recovers.\n`
  );
  process.exit(1);
}

if (SHARE) {
  // Nothing but the calls and the links. No counts, no reasoning, no house
  // vocabulary — this gets forwarded to people who did not run it.
  console.log(`Calls that were recorded but never scored — ${queue.length} of them.\n`);
  if (otherOffer.length > 0) {
    console.log(
      `(${otherOffer.length} more recordings were left off this list because they say they\n` +
        `were for a different offer. Nothing to do with them.)\n`
    );
  }
  console.log(
    `Each one needs a person to open the second link and confirm it was a sales\n` +
      `call. That scores it and puts it on the dashboard. If it was not a sales\n` +
      `call, ignore it and nothing happens.\n`
  );
  for (const { who, m } of queue) {
    const when = new Date(`${m.recording_start_time.slice(0, 10)}T12:00:00Z`).toLocaleDateString(
      "en-GB",
      { day: "numeric", month: "long", timeZone: "UTC" }
    );
    console.log(`${when} — ${who}, ${minutes(m)} minutes`);
    console.log(`  the recording: ${m.share_url}`);
    console.log(`  score it here: ${N8N_BASE}/form/score-call-${CLIENT}?recording=${m.recording_id}`);
    console.log("");
  }
  console.log(
    `Going forward these will be scored automatically, so this is a one-off\n` +
      `catch-up rather than something anyone has to keep doing.\n`
  );
} else {
  console.log(
    `\n${queue.length} recording(s) had a title that named nothing, and nobody ruled\n` +
      `on them. This is the backlog. Each line ends with the link that scores it.\n`
  );
  queue.forEach(line);
}

if (!SHARE) console.log(
  `Lines marked !! ran past fifteen minutes AND had someone from outside on\n` +
    `them, which is what a sales call looks like from here. Nothing above has\n` +
    `been changed — this only reads. Scoring one is a click on its own link.\n`
);

if (!SHARE && otherOffer.length > 0) {
  console.log(
    `\n${otherOffer.length} more were refused because the recording says they were for a\n` +
      `DIFFERENT OFFER. That is the rule working, not a backlog. They are listed with\n` +
      `what each one says it was for, in case a Funded Blueprint call was summarised\n` +
      `wrongly — scoring one of these would put another business's call on this\n` +
      `client's tracker and into their revenue.\n`
  );
  otherOffer.forEach(line);
}

if (!SHARE && onPurpose.length > 0) {
  console.log(
    `\n${onPurpose.length} more were refused BY NAME — their titles contain ` +
      `${BLOCKED_PHRASES.map((b) => `"${b}"`).join(", ")}.\n` +
      `That is the rule working, not a backlog, so none of them are ranked. They\n` +
      `are listed only in case a sales call was given one of those names by mistake.\n`
  );
  onPurpose.forEach(line);
}
