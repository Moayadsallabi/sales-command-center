#!/usr/bin/env node
/**
 * Fails when a dashboard's stylesheet has drifted from design-tokens.json, or
 * when the other repo's copy of that file has drifted from this one's.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * The same shape as scripts/check-rules.mjs, applied to colour instead of money.
 * Three apps deploy separately and cannot read each other at runtime, so each
 * keeps its own stylesheet with a comment at the top saying "keep these in
 * step". They did not stay in step: the client dashboard was measured and
 * rebuilt on 2026-08-19, and eight days later the agency screen was still
 * running the version that rebuild replaced -- so its navigation, filters,
 * column headers and every explanatory sentence sat at 4.1:1, under the
 * readable floor, on the screen that carries the money.
 *
 * A comment asking people to remember is not a mechanism. This is.
 *
 * When the other repo is not on this machine the comparison is skipped rather
 * than failed -- a deploy has one repo, not both.
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const mine = join(repo, "design-tokens.json");
const raw = readFileSync(mine, "utf8");
const tokens = JSON.parse(raw);

let failed = false;
const fail = (m) => { console.error(`  FAIL  ${m}`); failed = true; };
const ok = (m) => console.log(`  ok    ${m}`);

console.log(`\ndesign-tokens.json v${tokens.version} (sales-command-center)\n`);

/**
 * Every declaration of one custom property in a stylesheet.
 *
 * ALL of them, not the first: a token declared twice with different values is
 * exactly the drift being hunted, and returning the first would report the file
 * as clean. Declarations inside a media query or a `@theme` block are found the
 * same way, because a value that only applies at one width is still a value
 * this file has an opinion about.
 */
function declarationsOf(css, name) {
  const re = new RegExp(`(^|[;{\\s])${name}\\s*:\\s*([^;}]+)`, "g");
  const out = [];
  let m;
  while ((m = re.exec(css))) out.push(m[2].trim().toLowerCase());
  return out;
}

/** Checks one stylesheet against the map design-tokens.json holds for it. */
function checkStylesheet(label, path, map) {
  if (!existsSync(path)) {
    console.log(`  skip  ${label} is not on this machine`);
    return;
  }
  const css = readFileSync(path, "utf8");
  // `wrong` as well as `missing`: the first version of this printed
  // "all at the value this file names" underneath three failures, because it
  // only counted variables it could not find. A summary that contradicts the
  // lines above it is worse than no summary -- it is the shape of check people
  // learn to read instead of the detail.
  let checked = 0, missing = 0, wrong = 0;

  for (const [role, names] of Object.entries(map)) {
    const want = tokens.roles[role];
    if (!want) { fail(`${label}: names a role "${role}" that design-tokens.json does not define`); continue; }
    for (const name of names) {
      const found = declarationsOf(css, name);
      if (!found.length) {
        // A variable the map names and the stylesheet does not declare. Said
        // out loud rather than skipped: a map pointing at nothing is how a
        // check comes to assert nothing while still reporting "ok".
        fail(`${label}: ${name} is mapped to ${role} but declared nowhere in the file`);
        missing++;
        continue;
      }
      for (const value of found) {
        checked++;
        if (value !== want.value.toLowerCase()) {
          wrong++;
          fail(`${label}: ${name} is ${value}, ${role} is ${want.value}`);
          if (want.note) console.error(`        ${want.note}`);
        }
      }
    }
  }
  if (!missing && !wrong) ok(`${label}: ${checked} declarations, all at the value this file names`);
  else console.error(`        ${label}: ${wrong} of ${checked} declarations wrong, ${missing} mapped to nothing`);
}

// 1. Every stylesheet design-tokens.json claims to speak for.
for (const [rel, map] of Object.entries(tokens.declared_by)) {
  // Paths are written relative to the folder holding both repos, so the same
  // file works from either side without either one knowing where it sits.
  const path = resolve(repo, "..", rel);
  checkStylesheet(rel, path, map);
}

/**
 * 2. A BANISHED COLOUR MUST NOT SURVIVE AS A LITERAL.
 *
 * Checking the tokens alone is checking the wrong file. #ef4444 was removed
 * from both palettes and lived on as a typed hex in four Command Center
 * components and two login pages here, so the screen still rendered fifteen
 * elements in a colour the design system had banished -- and the token check
 * above said "tokens agree", because it was true and beside the point.
 *
 * A hit inside a COMMENT is allowed: the note explaining why a colour was
 * removed has to be able to name it. Only code and declarations are read.
 */
function sourceFiles(dir) {
  const out = [];
  const SKIP = new Set(["node_modules", ".git", ".next", "dist", "build", "fixtures", "docs"]);
  const walk = (d) => {
    let entries;
    try { entries = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(js|mjs|ts|tsx|jsx|css|html)$/.test(e.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/** Strips /* *\/, // and <!-- --> comments, so a colour can be discussed. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/(^|[^:"'\w])\/\/[^\n]*/g, "$1 ");
}

const REPOS = [
  { label: "perceptionismlabkpis", roots: ["public", "src"] },
  { label: "sales-command-center", roots: ["src"] },
];
for (const { label, roots } of REPOS) {
  const base = resolve(repo, "..", label);
  if (!existsSync(base)) { console.log(`  skip  ${label} is not on this machine`); continue; }
  const hits = [];
  for (const root of roots) {
    for (const file of sourceFiles(join(base, root))) {
      // The palette module is where the replacement values live and where the
      // removal is explained; its prose is stripped with the comments.
      const body = stripComments(readFileSync(file, "utf8"));
      for (const [colour, why] of Object.entries(tokens.banished)) {
        if (colour === "#71717a") continue;                 // allowed, see the note in the file
        if (body.toLowerCase().includes(colour)) hits.push({ file: file.slice(base.length + 1), colour, why });
      }
    }
  }
  if (hits.length) {
    for (const h of hits) {
      fail(`${label}/${h.file} still writes ${h.colour}`);
      console.error(`        ${h.why}`);
    }
  } else {
    ok(`${label}: no banished colour survives as a literal`);
  }
}

// 3. And the other repo's copy of THIS file must be byte-identical.
const SIBLINGS = [resolve(repo, "..", "perceptionismlabkpis", "design-tokens.json")];
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
    if (t.version !== tokens.version) console.error(`        version: this ${tokens.version}, other ${t.version}`);
    for (const role of new Set([...Object.keys(tokens.roles), ...Object.keys(t.roles || {})])) {
      const a = (tokens.roles[role] || {}).value, b = ((t.roles || {})[role] || {}).value;
      if (a !== b) console.error(`        ${role}: this ${a || "(absent)"}, other ${b || "(absent)"}`);
    }
    console.error(`        Copy the newer file over the older one, whole. Never edit one side.`);
  }
}
if (!compared) console.log(`  skip  the other repo is not on this machine, so nothing was compared`);

console.log(failed ? "\nTokens have drifted.\n" : "\nTokens agree.\n");
process.exit(failed ? 1 : 0);
