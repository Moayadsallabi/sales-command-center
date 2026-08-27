// Verifies the dashboard can actually read the bookings it expects.
// Run with: npm run check:calendly
//
// The failure this exists to catch is the quiet one: a token that works, an
// account that answers, and an event-type filter that matches nothing — which
// looks identical to "nobody booked anything" on the dashboard.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { loadEnv } from "./lib/notion-env.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const API = "https://api.calendly.com";


function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

loadEnv();

const token = (process.env.CALENDLY_API_KEY ?? "").trim();
if (!token) {
  fail(
    "CALENDLY_API_KEY is not set.",
    "Create a personal access token at calendly.com/integrations/api_webhooks and put it in .env.local"
  );
}

async function call(path, params) {
  let url = path.startsWith("http") ? path : `${API}${path}`;
  if (params) {
    const built = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) built.searchParams.set(key, value);
    }
    url = built.toString();
  }
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = await resp.json().catch(() => ({}));
  return { ok: resp.ok, status: resp.status, body };
}

/**
 * Every page of a collection. Follows `pagination.next_page` verbatim — a page
 * token is only valid against the exact query string it was issued for, so
 * rebuilding the parameters and appending the token returns 400.
 */
async function collect(path, params) {
  const out = [];
  let next = null;
  let failure = null;
  do {
    const r = next ? await call(next) : await call(path, { ...params, count: "100" });
    if (!r.ok) {
      failure = r;
      break;
    }
    out.push(...(r.body.collection ?? []));
    next = r.body.pagination?.next_page ?? null;
  } while (next);
  return { items: out, failure };
}

/* 1. Is the token valid, and how far does it reach? */

const me = await call("/users/me");
if (!me.ok) {
  fail(
    `Calendly rejected the token (${me.status}).`,
    "Personal access tokens are created at calendly.com/integrations/api_webhooks. Paste the token on its own, with no Bearer prefix."
  );
}

const user = me.body.resource ?? {};
console.log(`✓ Token valid — ${user.name ?? "unknown user"} <${user.email ?? "?"}>`);

const orgUri = user.current_organization;
const userUri = user.uri;

/* 2. Whose calendars can it see? */

// Same default as src/lib/calendly.ts, so this reports what the app will read.
const lookback = Number(process.env.CALENDLY_LOOKBACK_DAYS) || 90;
const minStart = new Date(Date.now() - lookback * 864e5).toISOString();
const maxStart = new Date(Date.now() + 365 * 864e5).toISOString();

let scope = orgUri ? "organization" : "user";
let scopeParams = scope === "organization" ? { organization: orgUri } : { user: userUri };

const listEvents = (status) =>
  collect("/scheduled_events", {
    ...scopeParams,
    status,
    min_start_time: minStart,
    max_start_time: maxStart,
  });

let events = await listEvents("active");

if (events.failure?.status === 403 && scope === "organization") {
  console.log(
    "  Organisation-wide reads refused — this token is a member, not an admin. Falling back to this user's own calendar."
  );
  scope = "user";
  scopeParams = { user: userUri };
  events = await listEvents("active");
}

if (events.failure) {
  fail(
    `Could not list scheduled events (${events.failure.status}): ${events.failure.body.message ?? ""}`,
    "An admin or owner token reads every closer's calendar; a member token reads only their own."
  );
}

console.log(
  scope === "organization"
    ? "✓ Reading the whole organisation — every closer's calendar is counted"
    : "⚠ Reading one user's calendar only — other closers' bookings will be missing"
);

const canceled = await listEvents("canceled");

const active = events.items;
const cancelled = canceled.items;
const all = active.concat(cancelled);

console.log(
  `✓ ${all.length} bookings in the last ${lookback} days (${active.length} live, ${cancelled.length} cancelled)`
);

/* 3. Does the event-type filter match anything? */

const types = await collect("/event_types", scopeParams);
const typeNames = new Map();
for (const type of types.items) {
  if (type.uri && type.name) typeNames.set(type.uri, type.name);
}

// Same semantics as src/lib/calendly.ts — the check must judge with the same
// rules the dashboard applies, or it reports a config as broken that works.
// "!name" excludes (exclusions win); a list of only exclusions means
// "everything except these".
const entries = (process.env.CALENDLY_EVENT_TYPES ?? "")
  .split(",")
  .map((n) => n.trim().toLowerCase())
  .filter((n) => n !== "");
const wanted = entries;
const excludes = entries.filter((e) => e.startsWith("!")).map((e) => e.slice(1).trim()).filter((e) => e !== "");
const includes = entries.filter((e) => !e.startsWith("!"));

const countsAsSales = (name) => {
  const n = name.toLowerCase();
  if (excludes.some((w) => n === w || n.includes(w))) return false;
  if (includes.length === 0) return true;
  return includes.some((w) => n === w || n.includes(w));
};

const nameOf = (event) =>
  (event.event_type ? typeNames.get(event.event_type) : null) ?? event.name ?? "";

const seen = new Map();
for (const event of all) {
  const name = nameOf(event);
  seen.set(name, (seen.get(name) ?? 0) + 1);
}

/**
 * Event types a human has already ruled on.
 *
 * SEPARATE FROM THE COUNTING RULE, ON PURPOSE.
 *
 * CALENDLY_EVENT_TYPES decides what counts. Whichever shape it takes, it
 * decides SILENTLY for anything new: a deny-list ("!onboarding") counts every
 * new event type by default, an allow-list drops every new one by default.
 * Both have already cost real numbers here — an allow-list once dropped the
 * Enrollment Call's 42 bookings, and the deny-list today counts "30 Minute
 * Meeting" as a sales call.
 *
 * This ledger is the second question: has anyone LOOKED at this type. It stays
 * quiet while the calendar holds what it held last time, and speaks the moment
 * Brey's team invents an event type nobody has ruled on — which is the only
 * moment worth interrupting for.
 */
const LEDGER = "calendly-event-types.json";
const ledgerPath = join(root, LEDGER);
const ledger = existsSync(ledgerPath)
  ? JSON.parse(readFileSync(ledgerPath, "utf8"))
  : null;

const acknowledged = new Set(
  (ledger?.ruled_on ?? []).map((e) => String(e.name).toLowerCase())
);

const unrecognised = [];

console.log("\n  Event types booked in this window:");
for (const [name, count] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
  const counted = wanted.length === 0 || countsAsSales(name);
  const isNew = ledger !== null && !acknowledged.has(name.toLowerCase());
  if (isNew) unrecognised.push({ name, count, counted });
  console.log(
    `    ${counted ? "counted " : "ignored "} ${String(count).padStart(4)}  ${name}${
      isNew ? "   ← NEW" : ""
    }`
  );
}

if (ledger === null) {
  console.log(
    `\n⚠ No ${LEDGER} in this repo, so a new event type cannot be spotted.` +
      `\n  Write one listing the types above and this check will speak up when the` +
      `\n  team invents another.`
  );
} else if (unrecognised.length > 0) {
  const bookings = unrecognised.reduce((sum, u) => sum + u.count, 0);
  console.log(
    `\n⚠ ${unrecognised.length} event type${unrecognised.length === 1 ? "" : "s"} ` +
      `on the calendar that nobody has ruled on (${bookings} booking${
        bookings === 1 ? "" : "s"
      }):`
  );
  for (const u of unrecognised) {
    console.log(
      `    ${String(u.count).padStart(4)}  ${u.name}` +
        `   → being counted as ${u.counted ? "A SALES CALL" : "not a sales call"} by default`
    );
  }
  console.log(
    `\n  A type counted by mistake sits in the booking funnel's denominator and` +
      `\n  drags the held rate and coverage down; one dropped by mistake takes its` +
      `\n  bookings off the page entirely. Rule on each, then add it to ${LEDGER}` +
      `\n  so this stays quiet until the next new one.`
  );
} else {
  console.log(`\n✓ Every event type on the calendar has been ruled on (${LEDGER})`);
}

if (wanted.length === 0) {
  console.log(
    "\n⚠ CALENDLY_EVENT_TYPES is not set, so every booking above counts as a sales call —" +
      "\n  including one-to-ones and personal meetings. Set it to the event types you sell on" +
      "\n  — or to exclusions like \"!onboarding\" to count everything except those."
  );
} else {
  const kept = all.filter((event) => countsAsSales(nameOf(event)));
  if (kept.length === 0) {
    fail(
      `CALENDLY_EVENT_TYPES matches none of the bookings above.`,
      `It is set to "${process.env.CALENDLY_EVENT_TYPES}". Copy an event type name from the list above — matching is case-insensitive and partial.`
    );
  }
  console.log(`\n✓ ${kept.length} of ${all.length} bookings count as sales calls`);
}

/* 4. Do the bookings carry what the dashboard joins and reads on? */

const sample = all.slice(0, 12);
let withEmail = 0;
let withTracking = 0;
let withAnswers = 0;
let sampled = 0;

for (const event of sample) {
  if (!event.uri) continue;
  const uuid = event.uri.split("/").filter(Boolean).pop();
  const invitees = await collect(`/scheduled_events/${uuid}/invitees`, {});
  if (invitees.failure) continue;
  for (const invitee of invitees.items) {
    sampled++;
    if (invitee.email) withEmail++;
    if (invitee.tracking?.utm_source) withTracking++;
    if ((invitee.questions_and_answers ?? []).length > 0) withAnswers++;
  }
}

if (sampled === 0) {
  console.log("\n  No invitees to sample yet.");
} else {
  console.log(`\n  Sampled ${sampled} invitees on the ${sample.length} most recent bookings:`);
  console.log(
    `    ${withEmail}/${sampled} have an email — this is the key a booking is matched to its recording by`
  );
  console.log(`    ${withTracking}/${sampled} carry a utm_source from the booking link`);
  console.log(`    ${withAnswers}/${sampled} have booking-form answers`);

  if (withEmail < sampled) {
    console.log(
      "\n⚠ Bookings without an email cannot be matched to a call, so they show as unaccounted."
    );
  }
  if (withTracking === 0) {
    console.log(
      "\n⚠ No booking carries a utm tag, so every booking reads as Untagged." +
        "\n  Add ?utm_source=instagram (and utm_campaign) to the links you publish, per source."
    );
  }
}

console.log("\nConnected. `npm run dev` will show the booking funnel.");
