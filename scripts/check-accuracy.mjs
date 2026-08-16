// Marks the dashboard's homework against an answer key.
// Run with: npm run check:accuracy [path/to/answers.json]
//
// The answer key is a record of what actually happened on a set of calls,
// written down by someone who was there — a closer's own tracking sheet. This
// replays the real reading and matching code over the same calls and reports
// how much of it the system found, how much it got right, and which ones it got
// wrong by name.
//
// The point is that a change to the matching rules produces a number instead of
// an opinion. Without it, "this should match more calls" is a guess that nobody
// can check, including the person who wrote it.
//
// It deliberately imports the app's own modules rather than reimplementing the
// logic. A copy of the matcher would pass its own test while the real one
// failed, which is worse than having no test at all.

import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const DEFAULT_TRUTH = "fixtures/accuracy-truth.json";
/** How many days apart a booking and the answer key's date may sit. */
const DAY_TOLERANCE = 1;

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

/* ------------------------------------------------------------- answer key */

const truthPath = resolve(process.argv[2] ?? process.env.ACCURACY_TRUTH_FILE ?? DEFAULT_TRUTH);
let answers;
try {
  answers = JSON.parse(readFileSync(truthPath, "utf8"));
} catch (err) {
  fail(
    `Could not read the answer key at ${truthPath}.`,
    `Copy fixtures/accuracy-truth.example.json to ${DEFAULT_TRUTH} and fill it in from a closer's tracking sheet. See docs/accuracy.md. (${err.code ?? err.message})`
  );
}

const calls = answers.calls ?? [];
if (calls.length === 0) fail("The answer key has no calls in it.");

/* --------------------------------------------- the app's own code, compiled */

// Compiled to CommonJS in a temp folder purely so Node can require it: the
// source imports without file extensions, which only a bundler resolves.
const build = mkdtempSync(join(tmpdir(), "scc-accuracy-"));
try {
  execFileSync(
    "npx",
    [
      "tsc",
      "src/lib/calendly.ts",
      "src/lib/bookings.ts",
      "src/lib/notion.ts",
      "--outDir", build,
      // Pinned so the output layout is predictable rather than derived from
      // whichever files happen to be listed above.
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
  fail(
    "The app's own code did not compile, so there is nothing to test.",
    String(err.stderr ?? err).slice(0, 600)
  );
}

const require = createRequire(import.meta.url);
const { queryBookings } = require(join(build, "calendly.js"));
const { linkBookings } = require(join(build, "bookings.js"));
const { queryAllCalls } = require(join(build, "notion.js"));

/* ------------------------------------------------------------------ inputs */

let notionCalls;
try {
  notionCalls = await queryAllCalls();
} catch (err) {
  rmSync(build, { recursive: true, force: true });
  fail(`Could not read the Notion tracker: ${err.message}`, "Run npm run check:notion first.");
}

let bookings;
try {
  let result = await queryBookings();
  if (result.pending > 0) {
    process.stdout.write(`  reading the calendar (${result.total} bookings)`);
    while (result.pending > 0) {
      await new Promise((r) => setTimeout(r, 4000));
      result = await queryBookings();
      process.stdout.write(".");
    }
    process.stdout.write("\n");
  }
  bookings = result.bookings;
} catch (err) {
  rmSync(build, { recursive: true, force: true });
  fail(`Could not read Calendly: ${err.message}`, "Run npm run check:calendly first.");
}

const link = linkBookings(bookings, notionCalls);
rmSync(build, { recursive: true, force: true });

/* ----------------------------------------------------------------- compare */

const parts = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);

const sharesName = (a, b) => parts(a).some((t) => parts(b).includes(t));

/**
 * A looser comparison, used only when asking "is this person in the tracker at
 * all". Meeting titles are typed by hand and drift — "Sushant" is logged as
 * "sushantt_05" — so one name part starting with another counts. Too loose for
 * deciding which booking a call belongs to, but the right question here is
 * whether the call reached the system, and a false alarm there sends someone
 * hunting a bug that does not exist.
 */
const sharesNameLoosely = (a, b) =>
  parts(a).some((x) =>
    parts(b).some((y) => x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))))
  );

const dayOf = (value) =>
  Math.floor(Date.parse(value.length === 10 ? `${value}T12:00:00Z` : value) / 864e5);

/** Recording dates drift a day or more from the closer's own date. */
const TRACKER_DAY_TOLERANCE = 3;

const tally = {
  onCalendar: 0,
  inTracker: 0,
  answered: 0,
  correct: 0,
  wrong: 0,
  unsure: 0,
  noBooking: 0,
};
const wrong = [];
const missingFromTracker = [];
const notOnCalendar = [];

for (const call of calls) {
  const day = dayOf(call.date);

  const inTracker = notionCalls.some(
    (c) =>
      c.call_date &&
      Math.abs(dayOf(c.call_date) - day) <= TRACKER_DAY_TOLERANCE &&
      sharesNameLoosely(c.name, call.name)
  );
  if (inTracker) tally.inTracker++;
  // A call the closer recorded that the tracker never received is invisible to
  // every number on the dashboard, not just this one. Worth its own line.
  else if (call.recorded) missingFromTracker.push(`${call.date}  ${call.name}`);

  const candidates = link.bookings
    .filter(
      (b) => Math.abs(dayOf(b.scheduled_at) - day) <= DAY_TOLERANCE && sharesName(b.name, call.name)
    )
    .sort((a, b) => Math.abs(dayOf(a.scheduled_at) - day) - Math.abs(dayOf(b.scheduled_at) - day));

  if (candidates.length === 0) {
    tally.noBooking++;
    notOnCalendar.push(`${call.date}  ${call.name}`);
    continue;
  }
  tally.onCalendar++;

  const booking = candidates[0];
  if (booking.state === "unrecorded" || booking.state === "upcoming") {
    tally.unsure++;
    continue;
  }

  tally.answered++;
  const saysShowed = booking.state === "kept";
  if (saysShowed === Boolean(call.showed)) tally.correct++;
  else {
    tally.wrong++;
    wrong.push(
      `${call.date}  ${call.name.padEnd(18)} key says ${call.showed ? "showed" : "no show"}, we say ${booking.state}`
    );
  }
}

/* ------------------------------------------------------------------ report */

const pct = (n, d) => (d === 0 ? "—" : `${Math.round((n / d) * 100)}%`);

console.log(`\nAnswer key: ${answers.label ?? truthPath}`);
if (answers.source) console.log(`Source:     ${answers.source}`);
console.log(`            ${calls.length} calls, ${calls.filter((c) => c.showed).length} of them showed up\n`);

console.log(`  on the calendar    ${String(tally.onCalendar).padStart(3)} of ${calls.length}   ${pct(tally.onCalendar, calls.length)}  — a booking was found`);
console.log(`  in the tracker     ${String(tally.inTracker).padStart(3)} of ${calls.length}   ${pct(tally.inTracker, calls.length)}  — a scored call was found`);
console.log(`  answered           ${String(tally.answered).padStart(3)} of ${calls.length}   ${pct(tally.answered, calls.length)}  — we committed to showed / did not`);
console.log(`  ├─ correct         ${String(tally.correct).padStart(3)}        ${pct(tally.correct, tally.answered)} of what we answered`);
console.log(`  └─ wrong           ${String(tally.wrong).padStart(3)}`);
console.log(`  unsure             ${String(tally.unsure).padStart(3)}        — booking found, no recording either way`);
console.log(`  no booking         ${String(tally.noBooking).padStart(3)}        — not on this Calendly at all`);

if (wrong.length) {
  console.log(`\n  Got these wrong:`);
  for (const line of wrong) console.log(`    ${line}`);
}

if (missingFromTracker.length) {
  console.log(`\n  ⚠ Recorded by the closer but missing from the tracker — these are absent`);
  console.log(`    from every figure on the dashboard, not just this one:`);
  for (const line of missingFromTracker) console.log(`    ${line}`);
}

if (notOnCalendar.length) {
  console.log(`\n  Not on this Calendly (booked some other way — the ceiling on coverage):`);
  for (const line of notOnCalendar.slice(0, 20)) console.log(`    ${line}`);
  if (notOnCalendar.length > 20) console.log(`    …and ${notOnCalendar.length - 20} more`);
}

console.log(
  `\n${tally.correct} of ${tally.answered} answered correctly, on ${calls.length} known calls.` +
    ` Re-run this after any change to the matching.\n`
);
