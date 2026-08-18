#!/usr/bin/env node
/**
 * Fails when this repo's copy of sales-rules.json has drifted from the other
 * dashboard's copy.
 *
 * The two apps deploy separately and cannot read each other at runtime, so the
 * file is duplicated. That duplication is the risk this script exists to cover:
 * four times in one evening the same rule was written twice and the two answers
 * diverged, and every one was found by a human noticing two screens disagree.
 *
 * When the sibling repo is not on this machine the comparison is skipped rather
 * than failed — CI has one repo, not both. What it still does everywhere is
 * check that this app's own constants match the file, which catches the other
 * half of the problem: a rule edited in the JSON and not picked up in code.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const mine = join(repo, "sales-rules.json");

const SIBLINGS = [
  resolve(repo, "..", "perceptionismlabkpis", "sales-rules.json"),
];

let failed = false;
const fail = (msg) => { console.error(`  FAIL  ${msg}`); failed = true; };
const ok = (msg) => console.log(`  ok    ${msg}`);

const raw = readFileSync(mine, "utf8");
const rules = JSON.parse(raw);
console.log(`\nsales-rules.json v${rules.version} (sales-command-center)\n`);

// 1. This app's own constants must equal the file.
const { MIN_DEPOSIT } = await import("../src/lib/sales-rules.ts").catch(() => ({}));
if (MIN_DEPOSIT === undefined) {
  ok(`min_deposit is $${rules.min_deposit.value} in the file (constants not loadable from a .mjs script — checked by tsc instead)`);
} else if (MIN_DEPOSIT !== rules.min_deposit.value) {
  fail(`code says MIN_DEPOSIT=${MIN_DEPOSIT}, file says ${rules.min_deposit.value}`);
} else {
  ok(`MIN_DEPOSIT matches the file ($${MIN_DEPOSIT})`);
}

// 2. The other dashboard's copy must be byte-identical.
let compared = false;
for (const sibling of SIBLINGS) {
  if (!existsSync(sibling)) continue;
  compared = true;
  const theirs = readFileSync(sibling, "utf8");
  if (theirs === raw) {
    ok(`identical to ${sibling}`);
  } else {
    const t = JSON.parse(theirs);
    fail(`DRIFTED from ${sibling}`);
    if (t.version !== rules.version) {
      console.error(`        version: this ${rules.version}, other ${t.version}`);
    }
    if (t.min_deposit?.value !== rules.min_deposit.value) {
      console.error(`        min_deposit: this ${rules.min_deposit.value}, other ${t.min_deposit?.value}`);
    }
    console.error(`        Copy the newer file over the older one, whole. Never edit one side.`);
  }
}
if (!compared) ok("the other dashboard is not on this machine — comparison skipped");

if (rules.outcomes?.refund?.NEEDS_A_RULING) {
  console.log(`\n  note  an open ruling is recorded in the file:\n        ${rules.outcomes.refund.NEEDS_A_RULING}`);
}

console.log(failed ? "\nRULES DRIFTED\n" : "\nRules agree.\n");
process.exit(failed ? 1 : 0);
