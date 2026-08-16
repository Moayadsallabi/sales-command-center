// Verifies the dashboard can actually read the bookings it expects.
// Run with: npm run check:calendly
//
// The failure this exists to catch is the quiet one: a token that works, an
// account that answers, and an event-type filter that matches nothing — which
// looks identical to "nobody booked anything" on the dashboard.

import { readFileSync } from "node:fs";

const API = "https://api.calendly.com";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    let raw;
    try {
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (!match) continue;
      const value = match[2].trim().replace(/^["']|["']$/g, "");
      if (!(match[1] in process.env)) process.env[match[1]] = value;
    }
  }
}

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

const wanted = (process.env.CALENDLY_EVENT_TYPES ?? "")
  .split(",")
  .map((n) => n.trim().toLowerCase())
  .filter((n) => n !== "");

const nameOf = (event) =>
  (event.event_type ? typeNames.get(event.event_type) : null) ?? event.name ?? "";

const seen = new Map();
for (const event of all) {
  const name = nameOf(event);
  seen.set(name, (seen.get(name) ?? 0) + 1);
}

console.log("\n  Event types booked in this window:");
for (const [name, count] of [...seen.entries()].sort((a, b) => b[1] - a[1])) {
  const counted =
    wanted.length === 0 ||
    wanted.some((w) => name.toLowerCase() === w || name.toLowerCase().includes(w));
  console.log(`    ${counted ? "counted " : "ignored "} ${String(count).padStart(4)}  ${name}`);
}

if (wanted.length === 0) {
  console.log(
    "\n⚠ CALENDLY_EVENT_TYPES is not set, so every booking above counts as a sales call —" +
      "\n  including one-to-ones and personal meetings. Set it to the event types you sell on."
  );
} else {
  const kept = all.filter((event) => {
    const name = nameOf(event).toLowerCase();
    return wanted.some((w) => name === w || name.includes(w));
  });
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
