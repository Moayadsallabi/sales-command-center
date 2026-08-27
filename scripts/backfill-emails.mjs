// Fills in the prospect's address on call rows that never got one.
// Run with: npm run backfill:emails [-- --apply]
//
// `Prospect Email` is the key every join in the system runs on — the Calendly
// booking behind a call, the Whop payment that followed it, the ad that
// produced the lead. The workflow fills it from the calendar invite, and on a
// live account most invites do not carry the prospect as an addressable
// attendee, so the column arrives empty and every one of those joins fails.
//
// Calendly already holds the address: the prospect typed their name and email
// to book. The dashboard already ties bookings to calls in order to draw the
// funnel. This copies what that match found onto the row.
//
// Nothing here decides which booking belongs to which call. That is the app's
// own matcher, imported and run exactly as the dashboard runs it — a copy would
// happily agree with itself while the real one disagreed.
//
// What this does add is a second opinion, because a wrong address is worse than
// a missing one. Most of those rows have no email precisely because the invite
// was thin, so the matcher had to fall back to the prospect's name and the day
// — and on a calendar taking twenty bookings a day, a first name is not proof.
//
// Fathom settles it. The recording carries the scheduled start time of the
// calendar event it was recording, and Calendly carries the scheduled start of
// the event it created. If they are the same moment, the booking and the
// recording are the same appointment, whatever the names looked like. Rows
// where the two disagree are held back and named rather than written and hoped
// about.
//
// That same slot does one more job. The matcher refuses to choose when two
// bookings fit one call, which is right for the funnel — a prospect who booked
// twice has one kept booking and one no-show, and guessing which is which
// invents a number. But the address is the same either way, and where it is
// not, the recording's slot says which booking was the one that happened. So a
// call the matcher declined can still be filled, provided the name agrees and
// every booking still standing points at one person.
//
// Two rules that never bend:
//   - A row that already has an email is never touched, whoever typed it.
//   - Anything unconfirmed is reported, not written.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { loadEnv, NOTION_VERSION } from "./lib/notion-env.mjs";

const FATHOM_API = "https://api.fathom.ai/external/v1/meetings";
/**
 * How far the recording's scheduled start may sit from the booking's and still
 * be the same appointment. Calendly writes the calendar event and Fathom reads
 * it back, so in practice this is zero to the second; the tolerance is for
 * clock skew, not for judgement.
 */
const SLOT_TOLERANCE_MINUTES = 5;
/** Notion allows roughly three writes a second. */
const WRITE_PAUSE_MS = 350;


function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

loadEnv();

const applying = process.argv.includes("--apply");
/**
 * Write the rows Fathom could not vouch for, on the strength of the name tie
 * alone. Off by default: those are exactly the rows where the matcher had the
 * least to go on, so they are the ones a second opinion was for.
 */
const unverified = process.argv.includes("--unverified");

const notionKey = process.env.NOTION_API_KEY;
const databaseId = process.env.NOTION_DATABASE_ID;
if (!notionKey || !databaseId) {
  fail(
    "NOTION_API_KEY and NOTION_DATABASE_ID are both needed.",
    "They are in .env.local. Run `npm run check:notion` first if that fails."
  );
}
if (!process.env.CALENDLY_API_KEY) {
  fail(
    "CALENDLY_API_KEY is not set, so there is nothing to copy from.",
    "See docs/calendly.md, then run `npm run check:calendly`."
  );
}

/**
 * Every Fathom key this install has. `backfill:fathom` takes one at a time from
 * the shell as `FATHOM_API_KEY`; a client with two closers keeps one key each
 * in `.env.local` as `FATHOM_KEY_<name>`, because a key only reaches its own
 * owner's recordings. Both spellings are read, so the check works either way.
 */
const fathomKeys = Object.entries(process.env)
  .filter(([name, value]) => value && (name === "FATHOM_API_KEY" || name.startsWith("FATHOM_KEY_")))
  .map(([, value]) => value);

/* --------------------------------------------- the app's own code, compiled */

// Compiled to CommonJS in a temp folder purely so Node can require it: the
// source imports without file extensions, which only a bundler resolves.
const build = mkdtempSync(join(tmpdir(), "scc-backfill-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/calendly.ts",
      "src/lib/bookings.ts",
      "src/lib/notion.ts",
      "--outDir", build,
      "--rootDir", "src/lib",
      "--module", "commonjs",
      "--moduleResolution", "node",
      "--target", "es2022",
      "--esModuleInterop",
      "--skipLibCheck",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
} catch (err) {
  rmSync(build, { recursive: true, force: true });
  fail(
    "The app's own code did not compile, so there is nothing to run.",
    String(err.stderr ?? err).slice(0, 600)
  );
}

const require = createRequire(import.meta.url);
const { queryBookings } = require(join(build, "calendly.js"));
const { linkBookings, closerDisagreements } = require(join(build, "bookings.js"));
const { queryAllCalls } = require(join(build, "notion.js"));

/* ------------------------------------------------------------------ inputs */

let calls;
try {
  calls = await queryAllCalls();
} catch (err) {
  rmSync(build, { recursive: true, force: true });
  fail(`Could not read the Notion tracker: ${err.message}`, "Run `npm run check:notion` first.");
}

let read;
try {
  read = await queryBookings();
  if (read.pending > 0) {
    process.stdout.write(`  reading the calendar (${read.total} bookings)`);
    while (read.pending > 0) {
      await new Promise((r) => setTimeout(r, 4000));
      read = await queryBookings();
      process.stdout.write(".");
    }
    process.stdout.write("\n");
  }
} catch (err) {
  rmSync(build, { recursive: true, force: true });
  fail(`Could not read Calendly: ${err.message}`, "Run `npm run check:calendly` first.");
}

const link = linkBookings(read.bookings, calls);
const disagreements = closerDisagreements(link.bookings, calls);
rmSync(build, { recursive: true, force: true });

const blank = calls.filter((c) => !c.prospect_email);

/* ------------------------------------------------------- the second opinion */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every recording one key can see, from `since` onwards. */
async function fathomMeetings(key, since) {
  const out = [];
  let cursor = null;
  do {
    const url = new URL(FATHOM_API);
    url.searchParams.set("created_after", since);
    if (cursor) url.searchParams.set("cursor", cursor);

    let body = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await fetch(url, { headers: { "X-Api-Key": key } });
      if (res.status === 429) {
        await sleep(Number(res.headers.get("retry-after") ?? 5) * 1000);
        continue;
      }
      // A key that has been rotated away is a reason to stop verifying, not a
      // reason to stop: the run falls back to the name tie and says so.
      if (!res.ok) return null;
      body = await res.json();
      break;
    }
    if (!body) return null;

    out.push(...(body.items ?? []));
    cursor = body.next_cursor ?? null;
  } while (cursor);
  return out;
}

/** Recordings by the share link the tracker stores, which is the join. */
const recordings = new Map();
let fathomReachable = fathomKeys.length > 0;

if (fathomReachable) {
  const oldest = blank
    .map((c) => c.call_date)
    .filter(Boolean)
    .sort()[0];
  const since = new Date(
    oldest ? Date.parse(`${oldest.slice(0, 10)}T00:00:00Z`) - 3 * 864e5 : Date.now() - 90 * 864e5
  ).toISOString();

  process.stdout.write(`  checking the recordings against the calendar`);
  for (const key of fathomKeys) {
    const meetings = await fathomMeetings(key, since);
    process.stdout.write(".");
    if (meetings == null) {
      fathomReachable = false;
      continue;
    }
    for (const m of meetings) {
      if (m.url) recordings.set(m.url, m);
      if (m.share_url) recordings.set(m.share_url, m);
    }
  }
  process.stdout.write("\n");
}

/**
 * Name parts two names share.
 *
 * The matcher has its own copy of this and keeps it private, which is correct —
 * that one decides which booking a call belongs to, and this one only ever asks
 * whether a booking the clock already identified is plausibly the same person.
 * Kept deliberately separate so tightening one never silently moves the other.
 */
function sharesName(a, b) {
  const tokens = (v) =>
    String(v ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
  const left = new Set(tokens(a));
  return tokens(b).some((t) => left.has(t));
}

/**
 * Whether the booking and the recording are the same appointment.
 *
 * Returns the reason it could not be confirmed rather than a bare false, so the
 * report can tell "the calendar says otherwise" apart from "there was nothing
 * to ask", which want completely different responses.
 */
function confirm(call, booking) {
  if (!fathomReachable) return { ok: false, why: "no-fathom" };
  const meeting = call.recording_url ? recordings.get(call.recording_url) : null;
  if (!meeting) return { ok: false, why: "no-recording" };
  if (!meeting.scheduled_start_time) return { ok: false, why: "no-slot" };

  const drift =
    Math.abs(Date.parse(meeting.scheduled_start_time) - Date.parse(booking.scheduled_at)) / 60000;
  if (!Number.isFinite(drift) || drift > SLOT_TOLERANCE_MINUTES) {
    // A slot that disagrees usually means the call was moved by hand after it
    // was booked, and the question then is whether the disagreement is about
    // *which* booking or about *who*. If every booking near this call under
    // this name belongs to one person, it is only about which — and the
    // address is the same whichever one it was. A prospect who booked, dropped
    // out and rebooked is the ordinary case, not the rare one.
    const near = read.bookings.filter(
      (b) =>
        b.email &&
        sharesName(call.name, b.name) &&
        Math.abs(Date.parse(b.scheduled_at) - Date.parse(call.call_date)) / 864e5 <= 1.5
    );
    const people = new Set(near.map((b) => b.email));
    if (people.size === 1 && near.length > 1) {
      return { ok: true, oneperson: true };
    }
    return { ok: false, why: "different-slot", drift };
  }

  // The invite occasionally does carry the prospect. One external attendee who
  // is not the person Calendly booked means the two records are describing
  // different people, whatever the clock says. More than one and there is no
  // telling which is the prospect, so it proves nothing either way.
  const externals = (meeting.calendar_invitees ?? []).filter((x) => x?.is_external && x.email);
  const emails = externals.map((x) => String(x.email).trim().toLowerCase());
  if (externals.length === 1 && emails[0] !== booking.email) {
    return { ok: false, why: "different-invitee", invitee: emails[0] };
  }

  return { ok: true, alsoOnInvite: emails.includes(booking.email) };
}

/**
 * How far from the call a booking may sit when the clock has already failed.
 *
 * Reached only on calls that were moved by hand after booking, where the
 * recording's slot matches no booking at all and so cannot vouch for anything.
 * Three days is wide enough to cover a call pushed across a weekend and narrow
 * enough that a name still means something inside it.
 */
const WIDE_SEARCH_DAYS = 3;

/** Midday on the call's date, so "before" and "after" read the way a person means them. */
const middleOf = (call) => Date.parse(`${String(call.call_date).slice(0, 10)}T12:00:00Z`);

/**
 * The last resort: a name, over a wider window, with nothing to confirm it.
 *
 * Everything stronger has already failed by the time this runs — no email, no
 * booking the matcher would accept, and a recording sitting on a slot no
 * booking holds. What is left is the name, and a name on its own is what the
 * rest of this script exists to avoid trusting. So it is reported and written
 * only on `--unverified`.
 *
 * Two conditions keep it honest. The name must actually tie, and every booking
 * it ties to across the window must belong to **one person** — the question
 * being answered is "whose address is this", and several candidates with
 * several addresses cannot answer it however close they sit.
 */
function widenByName(call, claimed) {
  if (!call.call_date) return null;
  const middle = Date.parse(`${call.call_date.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(middle)) return null;

  const near = read.bookings.filter(
    (b) =>
      !claimed.has(b.id) &&
      b.email &&
      sharesName(call.name, b.name) &&
      // Counted in calendar days, the way a person says "three days apart".
      // Measured in hours instead, a call moved from a Thursday night to the
      // following Sunday morning reads as 3.5 and falls out of a window it
      // plainly belongs in.
      Math.abs(Math.floor(Date.parse(b.scheduled_at) / 864e5) - Math.floor(middle / 864e5)) <=
        WIDE_SEARCH_DAYS
  );
  if (near.length === 0) return null;

  const people = new Set(near.map((b) => b.email));
  if (people.size > 1) return null;

  // Nearest to the call, so the row names the booking a person would check.
  const booking = near.sort(
    (a, b) =>
      Math.abs(Date.parse(a.scheduled_at) - middle) - Math.abs(Date.parse(b.scheduled_at) - middle)
  )[0];
  const days = Math.round(Math.abs(Date.parse(booking.scheduled_at) - middle) / 864e5);
  return { booking, days };
}

/**
 * The address for a call the matcher declined to match.
 *
 * Only the recording's own scheduled slot can reopen one of these, and only
 * alongside the name. A slot on its own is not enough: two closers take
 * bookings at the same hour, so the booking sitting in that slot is not
 * necessarily this call's — on this account it found a booking under a
 * completely different name, and a cancelled one under another.
 *
 * Bookings the matcher already tied to some other call are off limits, so this
 * can never take one away from a row that matched properly.
 */
function recover(call, claimed) {
  if (!fathomReachable) return null;
  const meeting = call.recording_url ? recordings.get(call.recording_url) : null;
  if (!meeting?.scheduled_start_time) return null;

  const slot = Date.parse(meeting.scheduled_start_time);
  if (!Number.isFinite(slot)) return null;

  const inSlot = read.bookings.filter(
    (b) =>
      !claimed.has(b.id) &&
      b.email &&
      Math.abs(Date.parse(b.scheduled_at) - slot) / 60000 <= SLOT_TOLERANCE_MINUTES
  );
  if (inSlot.length === 0) return null;

  const named = inSlot.filter((b) => sharesName(call.name, b.name));
  if (named.length === 0) return { blocked: "different-person", other: inSlot[0] };

  const emails = [...new Set(named.map((b) => b.email))];
  if (emails.length > 1) return { blocked: "several-people" };

  return { booking: named[0], count: named.length };
}

/* ---------------------------------------------------------------- the plan */

const contested = new Set(disagreements.map((d) => d.call.id));

const TIE = {
  "name-and-date": "full name, same day",
  "one-name-and-date": "one name, alone that day",
};

const confirmed = [];
const recovered = [];
const held = [];
const unconfirmed = [];
const noBooking = [];

/** Bookings the matcher already spoke for. Never reassigned by the tie-break. */
const claimed = new Set(
  link.bookings.filter((b) => b.call_id).map((b) => b.id)
);

for (const call of blank) {
  const booking = link.byCallId[call.id];
  if (!booking?.email) {
    // The matcher found nothing. The clock gets one attempt before this is
    // written off as booked somewhere other than Calendly.
    const second = recover(call, claimed);
    if (second?.booking) {
      claimed.add(second.booking.id);
      recovered.push({
        call,
        booking: second.booking,
        tie: second.count > 1 ? "same slot, one person" : "same slot, name agrees",
      });
      continue;
    }

    const wide = widenByName(call, claimed);
    if (wide) {
      claimed.add(wide.booking.id);
      unconfirmed.push({
        call,
        booking: wide.booking,
        tie: `name only, booked ${wide.days === 0 ? "the same day" : `${wide.days} day${wide.days === 1 ? "" : "s"} ${Date.parse(wide.booking.scheduled_at) < middleOf(call) ? "before" : "after"}`}`,
        why: "moved-by-hand",
      });
      continue;
    }

    noBooking.push({ call, blocked: second?.blocked, other: second?.other });
    continue;
  }

  // An email tie is impossible here by construction — the matcher only reaches
  // for a name when the row has no address — but assert it rather than assume
  // it, so a future change to the matcher shows up as a skipped row instead of
  // a silently different meaning.
  const tie = TIE[booking.match_method];
  if (!tie) {
    noBooking.push({ call });
    continue;
  }

  const entry = { call, booking, tie };

  if (contested.has(call.id)) {
    const d = disagreements.find((x) => x.call.id === call.id);
    held.push({ ...entry, why: "closer", detail: `booked for ${d?.assigned}, recorded by ${d?.credited}` });
    continue;
  }

  const verdict = confirm(call, booking);
  if (verdict.ok) {
    confirmed.push({
      ...entry,
      alsoOnInvite: verdict.alsoOnInvite,
      tie: verdict.oneperson ? `${tie}; booked more than once, one person` : tie,
    });
  }
  else if (verdict.why === "different-slot") {
    held.push({
      ...entry,
      why: "slot",
      detail: `Calendly has ${booking.scheduled_at.slice(0, 16).replace("T", " ")}Z, the recording was scheduled ${Math.round(verdict.drift / 60)}h away`,
    });
  } else if (verdict.why === "different-invitee") {
    held.push({ ...entry, why: "invitee", detail: `the invite names ${verdict.invitee}` });
  } else unconfirmed.push({ ...entry, why: verdict.why });
}

const byDate = (a, b) => (b.call.call_date ?? "").localeCompare(a.call.call_date ?? "");
confirmed.sort(byDate);
recovered.sort(byDate);
held.sort(byDate);
unconfirmed.sort(byDate);
noBooking.sort(byDate);

const chosen = unverified
  ? [...confirmed, ...recovered, ...unconfirmed]
  : [...confirmed, ...recovered];

/**
 * A fuller version of the name the row already holds.
 *
 * Meeting titles are whatever the closer typed, so most rows carry a bare first
 * name. The booking has what the prospect typed themselves. This only ever
 * lengthens a name it already agrees with — every part of the existing title
 * must appear in the booking's name — so "Kevin" becomes "Kevin Ashford" and a
 * disagreement is left alone. It matters beyond tidiness: `check:payments`
 * falls back to matching the buyer's billing name, and one word matches badly.
 */
function fullerName(call, booking) {
  const tokens = (v) =>
    String(v ?? "").toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t.length >= 3);
  const have = tokens(call.name);
  const offered = tokens(booking.name);
  if (have.length === 0 || offered.length <= have.length) return null;
  if (!have.every((t) => offered.includes(t))) return null;
  return booking.name.trim();
}

/* ----------------------------------------------------------------- report */

const pct = (n) => (blank.length === 0 ? "—" : `${Math.round((n / blank.length) * 100)}%`);
const line = (label, n, note) =>
  console.log(`  ${label.padEnd(22)} ${String(n).padStart(3)} of ${blank.length}  ${pct(n).padStart(4)}  ${note ?? ""}`);
const day = (c) => (c.call_date ?? "?").slice(0, 10);

console.log(`\nCall rows with no prospect email: ${blank.length} of ${calls.length}\n`);
line("confirmed", confirmed.length, "— Calendly and the recording are the same appointment");
line("recovered", recovered.length, recovered.length ? "— the matcher declined; the recording's slot settled it" : "");
line("unconfirmed", unconfirmed.length, unconfirmed.length ? "— matched, but nothing could vouch for it" : "");
line("held back", held.length, held.length ? "— two records disagree; see below" : "");
line("no booking", noBooking.length, "— nothing on this calendar matches; see below");

if (!fathomReachable) {
  console.log(
    `\n  ⚠ No Fathom key reached, so nothing could be confirmed. Matches below rest\n` +
      `    on the name and the day alone. Set FATHOM_API_KEY, or one FATHOM_KEY_<name>\n` +
      `    per closer in .env.local, to check them against the recordings.`
  );
}

if (confirmed.length) {
  console.log(`\nConfirmed — the booking and the recording hold the same calendar slot:\n`);
  for (const f of confirmed) {
    const fuller = fullerName(f.call, f.booking);
    console.log(
      `  ${day(f.call)}  ${f.call.name.padEnd(22)} → ${f.booking.email.padEnd(32)} (${f.tie})` +
        (f.alsoOnInvite ? "  + on the invite" : "")
    );
    if (fuller) console.log(`  ${" ".repeat(10)}  ${"".padEnd(22)}   name → ${fuller}`);
  }
}

if (recovered.length) {
  console.log(`\nRecovered — the matcher would not choose, the recording's slot did:\n`);
  for (const f of recovered) {
    const fuller = fullerName(f.call, f.booking);
    console.log(
      `  ${day(f.call)}  ${f.call.name.padEnd(22)} → ${f.booking.email.padEnd(32)} (${f.tie})`
    );
    if (fuller) console.log(`  ${" ".repeat(10)}  ${"".padEnd(22)}   name → ${fuller}`);
  }
}

if (unconfirmed.length) {
  console.log(
    `\nUnconfirmed — matched on the name, with no recording to check it against` +
      `${unverified ? ", written because --unverified was passed" : " (not written)"}:\n`
  );
  const WHY = {
    "no-fathom": "no Fathom key",
    "no-recording": "no recording found for this row",
    "no-slot": "the recording has no scheduled time",
    "moved-by-hand": "the recording sits on a slot no booking holds",
  };
  for (const f of unconfirmed) {
    console.log(
      `  ${day(f.call)}  ${f.call.name.padEnd(22)} → ${f.booking.email.padEnd(32)} (${f.tie}; ${WHY[f.why]})`
    );
  }
}

if (held.length) {
  console.log(`\nHeld back — the two records disagree, so neither is safe to copy from:\n`);
  for (const f of held) {
    console.log(`  ${day(f.call)}  ${f.call.name.padEnd(22)} ${f.booking.email}`);
    console.log(`  ${" ".repeat(10)}  ${f.detail}`);
  }
  console.log(
    `\n  Each of these has one record saying one thing and another saying something\n` +
      `  else. Settle it by opening the row and the booking, then type the address in\n` +
      `  by hand — a wrong address attaches somebody else's money to this call.`
  );
}

if (noBooking.length) {
  console.log(`\nNo booking — nothing on this Calendly can be tied to these:\n`);
  const WHY = {
    "different-person": "a booking sits in that slot under another name",
    "several-people": "several people booked that slot",
  };
  for (const f of noBooking) {
    const why = f.blocked
      ? WHY[f.blocked] + (f.other ? ` (${f.other.name})` : "")
      : "no booking matches the name or the slot";
    console.log(`  ${day(f.call)}  ${f.call.name.padEnd(22)} ${why}`);
  }
  console.log(
    `\n  Two different problems wear this label. Either the call was never booked\n` +
      `  here — taken over DM, or moved by hand onto a slot the booking no longer\n` +
      `  describes — or it was booked here and the row cannot be recognised as the\n` +
      `  same person, because a call is titled whatever the closer typed. A row\n` +
      `  reading "Unknown" is the second kind, and no amount of matching reaches it.\n` +
      `  Check the recording's own title before writing these off as not booked.`
  );
}

/* ------------------------------------------------------------------ apply */

if (!applying) {
  console.log(
    chosen.length
      ? `\nNothing has been written. Rerun with \`npm run backfill:emails -- --apply\` to write ${chosen.length} address${chosen.length === 1 ? "" : "es"} into Notion.\n`
      : `\nNothing to write.\n`
  );
  process.exit(0);
}

if (chosen.length === 0) {
  console.log(`\nNothing to write.\n`);
  process.exit(0);
}

console.log(`\nWriting ${chosen.length} row${chosen.length === 1 ? "" : "s"} to Notion:\n`);

let written = 0;
for (const f of chosen) {
  const properties = { "Prospect Email": { email: f.booking.email } };
  const fuller = fullerName(f.call, f.booking);
  if (fuller) properties.Name = { title: [{ text: { content: fuller } }] };

  const res = await fetch(`https://api.notion.com/v1/pages/${f.call.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error(`  ✗ ${f.call.name}: Notion refused the edit (${res.status}) ${detail.slice(0, 120)}`);
  } else {
    console.log(
      `  ✓ ${f.call.name.padEnd(22)} ${f.booking.email}` +
        (fuller ? `  + name → ${fuller}` : "") +
        (f.why ? "  [unconfirmed]" : "")
    );
    written++;
  }
  await sleep(WRITE_PAUSE_MS);
}

console.log(
  `\n${written} row${written === 1 ? "" : "s"} filled in. Notion's page history is the undo.\n` +
    `\`npm run check:payments\` can now match these to the money, and the booking\n` +
    `behind each one is tied by address rather than by inference.\n`
);
