#!/usr/bin/env node
/**
 * Refuses a scoring schema the model will reject at run time.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Structured output is enforced by compiling the JSON schema into a grammar,
 * and that grammar has a hard ceiling. Cross it and the API answers 400 for
 * every call — not for a malformed one, for ALL of them. The tracker stops
 * receiving calls and the only signal is a Slack alert nobody is watching at
 * 10pm.
 *
 * This has happened three times in three days on Brey's live account:
 *
 *   rubric v1.5.0     union-type limit    every call refused
 *   2026-08-18 00:30  union cleared, grammar limit not
 *   2026-08-18 00:39  grammar cleared     scoring resumed
 *
 * Seven of Brey's calls hit `Claude Analysis` between 22:05 and 23:27 that
 * night and every one came back 400.
 *
 * `check:workflow` could never catch it: it evaluates the n8n expressions
 * against a mock payload and never calls the API, so a schema the API will
 * refuse passes it every time. This is the missing half — it measures the
 * schema itself, before it can reach a real call.
 *
 * ---------------------------------------------------------------------------
 * THE NUMBERS
 *
 * The published limits are on the compiled grammar, which is not something
 * this script can build. What it can do is measure the inputs that drive its
 * size and hold them below where the schema is known to have failed. The
 * ceilings below are set from the two failures above, with room left under
 * them — they are a tripwire, not a specification.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// A path argument lets the test suite point this at a schema that is known to
// be too big, so the tripwire itself is covered rather than assumed.
const target = process.argv[2] ?? join(root, "rubric/output-schema.json");
const schema = JSON.parse(readFileSync(target, "utf8"));

/**
 * Where the schema sat when the API refused it, and where it sits now.
 * v1.5.0 failed with a string-enum union across the lead factors; the shape
 * that works carries them as bare numbers.
 */
const LIMITS = {
  /** Total characters of schema JSON. v1.5.0 was roughly twice this. */
  bytes: 24_000,
  /** Every `enum` member anywhere in the tree, added up. */
  enumMembers: 120,
  /** The largest single enum. A long one is what blew the union limit. */
  largestEnum: 40,
  /** Nesting depth. Deep trees compile to bigger grammars. */
  depth: 8,
  /** Distinct properties across the whole tree. */
  properties: 80,
};

let failed = false;
const fail = (m) => {
  console.error(`  FAIL  ${m}`);
  failed = true;
};
const ok = (m) => console.log(`  ok    ${m}`);

function measure(node, depth = 0) {
  let stats = { enumMembers: 0, largestEnum: 0, depth, properties: 0 };
  if (Array.isArray(node)) {
    for (const v of node) {
      const s = measure(v, depth);
      stats = merge(stats, s);
    }
    return stats;
  }
  if (node && typeof node === "object") {
    if (Array.isArray(node.enum)) {
      stats.enumMembers += node.enum.length;
      stats.largestEnum = Math.max(stats.largestEnum, node.enum.length);
    }
    if (node.properties && typeof node.properties === "object") {
      stats.properties += Object.keys(node.properties).length;
    }
    for (const [key, value] of Object.entries(node)) {
      const deeper = key === "properties" || key === "items" ? depth + 1 : depth;
      stats = merge(stats, measure(value, deeper));
    }
  }
  return stats;
}

function merge(a, b) {
  return {
    enumMembers: a.enumMembers + b.enumMembers,
    largestEnum: Math.max(a.largestEnum, b.largestEnum),
    depth: Math.max(a.depth, b.depth),
    properties: a.properties + b.properties,
  };
}

const bytes = JSON.stringify(schema).length;
const stats = measure(schema);

console.log(`\nscoring schema — ${target.replace(root + "/", "")}\n`);

const check = (label, value, limit, unit = "") => {
  const line = `${label}: ${value}${unit} (ceiling ${limit}${unit})`;
  if (value > limit) fail(`${line} — the API will refuse every call`);
  else ok(line);
};

check("size", bytes, LIMITS.bytes, " chars");
check("enum members, all", stats.enumMembers, LIMITS.enumMembers);
check("largest single enum", stats.largestEnum, LIMITS.largestEnum);
check("nesting depth", stats.depth, LIMITS.depth);
check("properties", stats.properties, LIMITS.properties);

if (schema.additionalProperties !== false) {
  fail("additionalProperties must be false, or the model may invent columns");
} else {
  ok("additionalProperties is false");
}

if (failed) {
  console.error(`
  The schema is too big for structured output. Every call would come back 400
  and the tracker would stop receiving calls silently.

  What worked last time: carry the lead factors as bare numbers rather than as
  a union of labelled strings, and drop any enum that only documents a value
  rather than constraining it.
`);
  process.exit(1);
}

console.log(`
  Within every ceiling. This does not compile the grammar — it measures what
  drives its size and holds it under where the schema has actually failed, so
  treat it as a tripwire rather than a guarantee. The only complete proof is a
  real call: after any rubric change, watch the next execution in n8n reach
  "Write to Notion" rather than stopping at "Claude Analysis".
`);
