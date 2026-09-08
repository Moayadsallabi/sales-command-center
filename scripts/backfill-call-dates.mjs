#!/usr/bin/env node
// Puts a call back on the day its team actually worked.
//
// Run with: npm run backfill:call-dates [-- --apply]
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// Until 2026-09-07 the tracker dated a call on a UTC day. Brey's team works
// America/New_York, so anything starting after about 8pm their time was filed
// on the FOLLOWING day. Nothing looked broken, because a UTC day is a real
// date — it was simply the wrong one. Twenty-four of Brey's rows are on the
// wrong day and three of those sit in the wrong MONTH, including a $2,000 deal
// counted in August that happened on 31 July.
//
// The automation now writes the client's own day, so this is only about the
// rows written before that. It is a one-off, and it is written down rather
// than run by hand because a bulk edit of a client's tracker should be
// reviewable, repeatable, and refuse to guess.
//
// ---------------------------------------------------------------------------
// WHAT IT WILL NOT DO
//
// · It joins on RECORDING ID and nothing else. No name matching, no matching
//   by time or by day — those are the guesses that put one buyer's call
//   against another buyer's payment on this account before.
// · It only moves a row when the recorder disagrees with it. A row already on
//   the right day is left untouched, so re-running changes nothing.
// · It writes the exact start with the client's offset, which is the same
//   value the automation writes for a new call today. History and new rows
//   then carry one shape rather than two.
// · It touches the Call Date and NOTHING else. Names were deliberately left
//   alone: the new rule is stricter, so on old calls it sometimes refuses
//   where the old one guessed, and five rows would have LOST a name that is
//   already there — possibly one a person typed in by hand.
//
// It prints every change and writes nothing without --apply.
import { loadEnv, NOTION_VERSION } from "./lib/notion-env.mjs";
loadEnv();
import { readAllRecordings } from "./lib/fathom.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const applying = process.argv.includes("--apply");
const zoneArg = process.argv.indexOf("--timezone");
const ZONE = zoneArg !== -1 ? process.argv[zoneArg + 1] : "America/New_York";

const notionKey = process.env.NOTION_API_KEY;
if (!notionKey) {
  console.error("\n✗ NOTION_API_KEY is not set. See .env.example.");
  process.exit(1);
}

/** The exact start, written in the client's own offset. Same as the tracker. */
function stampIn(iso, zone) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  const o = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
    .formatToParts(d).find((x) => x.type === "timeZoneName");
  const off = ((o && o.value) || "GMT+00:00").replace("GMT", "") || "+00:00";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}:${g("second")}.000${off}`;
}

/* --------------------------------------------- the app's own code, compiled */
// Compiled to CommonJS in a temp folder purely so Node can require it, the same
// way backfill-emails does: the source imports without file extensions, which
// only a bundler resolves. The point is that this reads the tracker through the
// DASHBOARD'S OWN reader rather than a second copy that would drift from it.
const build = mkdtempSync(join(tmpdir(), "scc-calldates-"));
let queryAllCalls;
try {
  execFileSync("npx", [
    "tsc", "src/lib/notion.ts",
    "--outDir", build, "--rootDir", "src/lib",
    "--module", "commonjs", "--moduleResolution", "node",
    "--target", "es2022", "--esModuleInterop", "--skipLibCheck",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  queryAllCalls = createRequire(import.meta.url)(join(build, "notion.js")).queryAllCalls;
} catch (err) {
  rmSync(build, { recursive: true, force: true });
  console.error("\n✗ The app's own code did not compile, so there is nothing to run.");
  console.error(String(err.stderr ?? err).slice(0, 600));
  process.exit(1);
}

const calls = await queryAllCalls();
rmSync(build, { recursive: true, force: true });

const keys = Object.entries(process.env)
  .filter(([k, v]) => k.startsWith("FATHOM_KEY_") && v)
  .map(([, v]) => v);
if (keys.length === 0) {
  console.error("\n✗ No FATHOM_KEY_* set — there is nothing to read the true start time from.");
  process.exit(1);
}

const starts = new Map();
for (const key of keys)
  for (const m of await readAllRecordings(key, { createdAfter: "2026-01-01T00:00:00Z" }))
    if (m.recording_id != null && m.recording_start_time)
      starts.set(String(m.recording_id), m.recording_start_time);

const moves = [];
let unmatched = 0;
for (const c of calls) {
  const start = c.recording_id != null ? starts.get(String(c.recording_id)) : null;
  if (!start) { unmatched++; continue; }
  const stamp = stampIn(start, ZONE);
  if (!stamp) continue;
  const was = (c.call_date ?? "").slice(0, 10);
  if (!was || was === stamp.slice(0, 10)) continue;
  moves.push({ id: c.id, who: c.name, was, now: stamp.slice(0, 10), stamp });
}

moves.sort((a, b) => a.was.localeCompare(b.was));
const crossing = moves.filter((m) => m.was.slice(0, 7) !== m.now.slice(0, 7));

console.log(`\nRows read: ${calls.length}   with no recording to check against: ${unmatched}`);
console.log(`Rows on the wrong day: ${moves.length}   of those, in the wrong month: ${crossing.length}\n`);
for (const m of moves)
  console.log(
    `  ${m.was.slice(0, 7) !== m.now.slice(0, 7) ? "MONTH " : "      "}` +
    `${m.was} -> ${m.now}   ${String(m.who ?? "").slice(0, 30)}`
  );

if (!applying) {
  console.log(
    moves.length === 0
      ? "\nEvery row is already on the right day. Nothing to do.\n"
      : `\nNothing has been written. Rerun with \`npm run backfill:call-dates -- --apply\` to move ${moves.length} rows.\n`
  );
  process.exit(0);
}

let written = 0;
for (const m of moves) {
  const res = await fetch(`https://api.notion.com/v1/pages/${m.id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionKey}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties: { "Call Date": { date: { start: m.stamp } } } }),
  });
  if (!res.ok) {
    console.error(`  ✗ ${m.who}: Notion refused the edit (${res.status}) ${(await res.text()).slice(0, 120)}`);
  } else {
    written++;
    console.log(`  ✓ ${m.was} -> ${m.now}   ${m.who ?? ""}`);
  }
}
console.log(`\n${written} of ${moves.length} rows moved.\n`);
