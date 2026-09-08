/**
 * What each check needs before it can run, and the one way it says it cannot.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * On 2026-09-08 the daily report said "Delivery — the check could not complete,
 * so whether calls are arriving is UNKNOWN". It had said that every day since
 * it moved onto a server, and would have gone on saying it for ever: the
 * scheduled service was never given a FATHOM_KEY_*, so the one check that
 * exists because SILENCE LOOKED LIKE HEALTH was itself silent for a reason
 * nobody could see from the message.
 *
 * The same morning showed the other two ways this goes wrong, from the same
 * cause. Three checks, one missing configuration each, three different lies:
 *
 *   check-delivery  exited 1 with "no FATHOM_KEY_*"     → reported as UNKNOWN.
 *                   Honest, but unactionable — "could not complete" names no
 *                   cause, so it reads as a flaky recorder rather than a
 *                   variable nobody set.
 *   check-dropped   exited 1 with "no .env.local"       → reported as NOTHING.
 *                   The runner reads a count out of its output; no output means
 *                   no count means no line, and the backlog silently vanished.
 *   check-claims    exited 1 with "no .env.local"       → reported as a FINDING.
 *                   The runner read any non-zero exit as "a claim no longer
 *                   holds", so a check that never ran published an alarm about
 *                   a client's money every single day.
 *
 * A check that CANNOT RUN is not a pass, and it is not a finding. It is a third
 * thing, and until this file it had no way to say so — every script exited 1
 * for "I found something" and 1 for "I was not configured", and the caller was
 * left guessing from the text.
 *
 * ---------------------------------------------------------------------------
 * WHY THE REQUIREMENT LIVES HERE AND NOT IN EACH SCRIPT
 *
 * Two things need to know what a check needs: the check, and the report that
 * has to explain why the check did not run. Written twice they drift, and the
 * stale one answers confidently — this workspace has paid for that shape
 * enough times to stop writing it.
 *
 * So it is declared once, below, and the script itself is the first consumer.
 * That is what keeps it true: a wrong entry here breaks the check that owns it,
 * loudly, on the next run — rather than sitting in a list nobody executes.
 */
import { loadEnv } from "./notion-env.mjs";

/**
 * Exit code for "I was not configured, so I checked nothing".
 *
 * Deliberately distinct from the two that already existed:
 *   0  ran, found nothing
 *   1  ran, found something a person must act on
 *   2  started and broke (a refused API, a timeout)
 *   3  never started — a variable this deploy does not have
 *
 * 2 and 3 both mean "no answer", and are still worth separating: 2 is a bad
 * morning that may fix itself, 3 is a person adding a variable and will not fix
 * itself in a hundred years of retries.
 */
export const NOT_CONFIGURED = 3;

/**
 * What an exit code MEANS, in one place, so no caller can collapse four
 * outcomes into two.
 *
 * The weekly report used to read `code === 0` as "clean" and everything else as
 * "found something", which is how a check that never started came to publish a
 * daily alarm about a client's money. Naming the four states makes that
 * collapse something you have to write on purpose.
 */
export const CLEAN = "clean";
export const FINDING = "finding";
export const BROKE = "broke";
export const UNCONFIGURED = "not-configured";

export function outcomeOf(code) {
  if (code === 0) return CLEAN;
  if (code === 1) return FINDING;
  if (code === NOT_CONFIGURED) return UNCONFIGURED;
  return BROKE;
}

/**
 * The one declaration.
 *
 * `names` are variables that must each be present. `prefixes` are families
 * where AT LEAST ONE match is enough — a client with two closers has two
 * FATHOM_KEY_ entries and a client with five has five, so naming them
 * individually would be a list that goes stale every time a closer joins.
 */
export const REQUIREMENTS = {
  "check-payments.mjs": {
    names: ["NOTION_API_KEY", "NOTION_DATABASE_ID", "WHOP_API_KEY"],
    hint: "The Whop key needs the payment:basic:read permission.",
  },
  "check-collect.mjs": {
    names: ["NOTION_API_KEY", "NOTION_DATABASE_ID", "WHOP_API_KEY"],
  },
  "check-claims.mjs": {
    names: ["WHOP_API_KEY"],
    hint: "Without it no acted-on claim can be re-asked of the processor.",
  },
  "check-identified.mjs": {
    names: ["NOTION_API_KEY", "NOTION_DATABASE_ID"],
  },
  "check-delivery.mjs": {
    names: ["NOTION_API_KEY", "NOTION_DATABASE_ID"],
    prefixes: ["FATHOM_KEY_"],
    hint:
      "One key per closer, named FATHOM_KEY_<closer> — a Fathom key only reaches " +
      "its own owner's recordings, so a missing one hides that closer entirely.",
  },
  "check-dropped.mjs": {
    names: ["NOTION_API_KEY", "NOTION_DATABASE_ID"],
    prefixes: ["FATHOM_KEY_"],
    hint: "One key per closer, named FATHOM_KEY_<closer>.",
  },
};

/**
 * What this environment is missing for one check, as plain strings. Empty means
 * it can run.
 *
 * Reads process.env, so the caller loads the env files first — which is what
 * lets the runner ask this question about ITSELF and get the same answer the
 * child process would get, without spawning anything.
 */
export function missingFor(scriptName) {
  const spec = REQUIREMENTS[scriptName];
  if (!spec) throw new Error(`No environment requirement declared for ${scriptName}.`);

  const missing = [];
  for (const name of spec.names ?? []) {
    if (!process.env[name]) missing.push(name);
  }
  for (const prefix of spec.prefixes ?? []) {
    const found = Object.entries(process.env).some(([k, v]) => k.startsWith(prefix) && v);
    if (!found) missing.push(`${prefix}<closer>  (at least one)`);
  }
  return missing;
}

/**
 * Load the env files, then stop the script with exit 3 if anything it needs is
 * absent. Returns nothing; a script that gets past this line is configured.
 *
 * The wording matters more than it looks. "Could not complete" sent somebody
 * looking at Fathom for a fault that was never there; naming the variable and
 * saying NOTHING WAS CHECKED points at the one action that fixes it.
 */
export function requireEnv(scriptName) {
  loadEnv();
  const missing = missingFor(scriptName);
  if (missing.length === 0) return;

  const spec = REQUIREMENTS[scriptName];
  console.error(`\n✗ NOT CONFIGURED — ${scriptName} cannot run here.\n`);
  for (const name of missing) console.error(`    missing  ${name}`);
  console.error("");
  if (spec.hint) console.error(`  ${spec.hint}`);
  console.error("  Locally these live in .env.local. On a deploy they are the service's variables.");
  console.error("  NOTHING WAS CHECKED — this is a configuration fault, not a finding.\n");
  process.exit(NOT_CONFIGURED);
}
