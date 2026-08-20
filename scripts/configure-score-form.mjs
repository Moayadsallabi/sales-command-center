// Builds the "Score this call" form for one client, from a template in this
// repo rather than by hand in n8n.
//
// ---------------------------------------------------------------------------
// WHY THIS SCRIPT EXISTS AT ALL
//
// The form was built directly in n8n on 20 August 2026 and lived nowhere else.
// Losing that account would have lost it, and nothing in the repo described
// what it did. It is also the second half of a rule that was already split in
// two: the tracker's filter lets a call through when the body carries
// `force_score`, and this form is the only thing that ever sets it. Half a
// mechanism in a generator and half in a web app is how the two drift.
//
// ---------------------------------------------------------------------------
// WHAT THE FORM IS FOR
//
// A recording Fathom names "Impromptu Google Meet Meeting" carries no evidence
// of what kind of call it was, so the tracker refuses to guess and posts it to
// Slack for a person to decide. That decision needed a tool. This is it: paste
// the recording id from the alert, and the same meeting is re-posted to the
// tracker's webhook with `force_score` set, so it runs through the identical
// dedupe, scoring and Notion write as a call that arrived on its own.
//
// ONE FATHOM NODE PER CLOSER, AND THAT IS NOT AN ACCIDENT. A Fathom API key
// reaches its own owner's recordings and nothing else, so a form with one key
// silently cannot find half the team's calls. Pass --closer once per closer,
// then attach each one's key to the node named after them.
//
//   npm run configure:score-form -- \
//     --client brey --name "Brey" \
//     --closer Christian --closer Tpan
//
// Import the written file into n8n, attach one Fathom credential per
// "Ask Fathom - …" node, then switch it on.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = join(ROOT, "automation", "score-this-call.template.json");

/**
 * The transcript floor, taken from the client's tracker rather than repeated.
 *
 * The tracker's "Has Transcript?" gate sends anything shorter than this to a
 * No show row. If the form used a different number, a call could pass the form
 * and be filed as a no-show anyway, with nothing said to the person who just
 * asked for it to be scored.
 */
function minTranscriptWords(client) {
  const path = join(ROOT, "automation", "generated", `sales-call-tracker-${client}.json`);
  let workflow;
  try {
    workflow = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(
      `No generated tracker for "${client}" at ${path}.`,
      "Run configure:client first — the form posts into that tracker's webhook and has to agree with it.",
    );
  }
  const node = workflow.nodes.find((n) => n.name === "Has Transcript?");
  const expr = node?.parameters?.conditions?.conditions?.[0]?.leftValue ?? "";
  const m = expr.match(/>=\s*(\d+)/);
  if (!m) {
    fail(
      `Could not read the transcript floor out of ${path}.`,
      "The Has Transcript? node's expression changed shape — update this script to match.",
    );
  }
  return { words: Number(m[1]), path };
}

function fail(message, hint) {
  console.error(`\n✗ ${message}`);
  if (hint) console.error(`  ${hint}`);
  process.exit(1);
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) fail(`--${name} needs a value after it.`);
  return value;
}

function argAll(name) {
  const values = [];
  process.argv.forEach((a, i) => {
    if (a !== `--${name}`) return;
    const value = process.argv[i + 1];
    if (!value || value.startsWith("--")) fail(`--${name} needs a value after it.`);
    values.push(value);
  });
  return values;
}

const client = arg("client");
const display = arg("name") ?? client;
const closers = argAll("closer");
const days = Number(arg("days") ?? 90);
const n8nBase = (arg("n8n") ?? process.env.N8N_BASE_URL ?? "https://moayad.app.n8n.cloud").replace(/\/+$/, "");
const webhook = arg("webhook") ?? `${n8nBase}/webhook/fathom-webhook-${client}`;

if (!client) fail("--client needs the client handle.", "The same handle you passed to configure:client.");
if (!/^[a-z0-9-]+$/.test(client)) {
  fail(`--client "${client}" must be lowercase letters, numbers and dashes only.`);
}
if (closers.length === 0) {
  fail(
    "--closer is required, once per closer who records calls.",
    "A Fathom key only reaches its own owner's recordings, so a closer with no node here\n" +
      "  is a closer whose calls this form can never find.",
  );
}
for (const name of closers) {
  // The name becomes a node name AND a string inside the Code node that looks
  // that node up. A quote in either breaks the lookup rather than the import,
  // which is the kind of failure that only shows up when someone needs it.
  if (!/^[A-Za-z0-9 ._-]+$/.test(name)) {
    fail(`--closer "${name}" should be a plain name — letters, numbers, spaces, dots, dashes.`);
  }
}
if (new Set(closers.map((c) => c.toLowerCase())).size !== closers.length) {
  fail("Two closers have the same name, so one node would overwrite the other.");
}
if (!Number.isInteger(days) || days < 1 || days > 365) {
  fail(`--days "${arg("days")}" should be a whole number of days, 1 to 365.`);
}

const floor = minTranscriptWords(client);
const template = JSON.parse(readFileSync(TEMPLATE, "utf8"));

const PATTERN = "Ask Fathom - __CLOSER__";
const patternNode = template.nodes.find((n) => n.name === PATTERN);
if (!patternNode) fail(`The template has no "${PATTERN}" node.`);

// One node per closer, chained in order. Chained rather than fanned out
// because the Code node reads every source by name afterwards — the order
// costs a little wall-clock and buys a shape that is obvious on the canvas.
const fathomNodes = closers.map((name, i) => {
  const node = JSON.parse(JSON.stringify(patternNode));
  node.name = `Ask Fathom - ${name}`;
  node.id = `b1000000-0000-4000-8000-1000000000${String(i).padStart(2, "0")}`;
  node.position = [160 + i * 176, 0];
  node.notes = node.notes.split("__CLOSER__").join(name);
  return node;
});

const sourceNames = fathomNodes.map((n) => n.name);

template.nodes = template.nodes.flatMap((n) => (n.name === PATTERN ? fathomNodes : [n]));

// The chain: form → each closer in turn → find → send → confirm.
const chain = ["Score a call", ...sourceNames, "Find the call", "Send it to the tracker", "Confirm"];
template.connections = Object.fromEntries(
  chain.slice(0, -1).map((from, i) => [from, { main: [[{ node: chain[i + 1], type: "main", index: 0 }]] }]),
);

const substitutions = {
  __CLIENT_NAME__: display,
  __CLIENT_SLUG__: client,
  __TRACKER_WEBHOOK__: webhook,
  __WINDOW_DAYS__: String(days),
  __MIN_TRANSCRIPT_WORDS__: String(floor.words),
  __FATHOM_SOURCES__: JSON.stringify(sourceNames),
};

let text = JSON.stringify(template);
for (const [token, value] of Object.entries(substitutions)) {
  text = text.split(token).join(token === "__FATHOM_SOURCES__" ? value.replace(/"/g, '\\"') : value);
}
const configured = JSON.parse(text);

/* --------------------------------------------------------------- checks */

const finalText = JSON.stringify(configured);
for (const token of Object.keys(substitutions)) {
  if (finalText.includes(token)) fail(`The ${token} placeholder survived.`);
}
if (finalText.includes("__CLOSER__")) fail("A __CLOSER__ placeholder survived.");

const formNode = configured.nodes.find((n) => n.name === "Score a call");
if (formNode.parameters.options.path !== `score-call-${client}`) {
  fail("The form path did not take, so the link in the Slack alert would 404.");
}
if (configured.nodes.find((n) => n.name === "Send it to the tracker").parameters.url !== webhook) {
  fail("The tracker webhook did not take.");
}

// THE CHECK THAT MATTERS MOST. The Code node looks its sources up by name. A
// name that does not exist returns nothing and is caught by a try/catch, so a
// typo here does not fail — it quietly drops that closer's recordings and the
// form says "could not find that recording" about a call that is right there.
const code = configured.nodes.find((n) => n.name === "Find the call").parameters.jsCode;
const declared = JSON.parse(code.match(/const sources = (\[[^\]]*\]);/)[1]);
const present = configured.nodes.filter((n) => n.name.startsWith("Ask Fathom - ")).map((n) => n.name);
if (declared.join("|") !== present.join("|")) {
  fail(
    "The Code node's source list does not match the Fathom nodes on the canvas.",
    `  code: ${declared.join(", ")}\n  nodes: ${present.join(", ")}`,
  );
}

// And the node it reaches back to for the form's own answers.
if (!code.includes("$('Score a call')")) fail("The Code node no longer reads the form trigger by name.");

// Run it. Reading the code back cannot tell you it produces force_score.
const run = (form, meetingsBySource) => {
  const $ = (name) => {
    if (name === "Score a call") return { first: () => ({ json: form }) };
    const items = meetingsBySource[name];
    if (items === undefined) throw new Error(`no node ${name}`);
    return { all: () => [{ json: { items } }] };
  };
  return new Function("$", code)($);
};
const meeting = {
  recording_id: 175005047,
  share_url: "https://fathom.video/share/abc123",
  meeting_title: "Impromptu Google Meet Meeting",
  recorded_by: { name: closers[0] },
  transcript: Array.from({ length: floor.words }, () => ({ text: "word" })),
};
const populated = Object.fromEntries(sourceNames.map((n, i) => [n, i === 0 ? [meeting] : []]));

const byId = run({ recording: "175005047" }, populated);
if (byId[0].json.force_score !== true) {
  fail("The form does not set force_score, so every call it sends is turned away by the tracker.");
}
if (run({ recording: meeting.share_url }, populated)[0].json.force_score !== true) {
  fail("A Fathom share link is not resolving to the recording.");
}
const renamed = run({ recording: "175005047", prospect_name: "Ron Smith" }, populated);
if (!renamed[0].json.meeting_title.startsWith("Ron Smith: ")) {
  fail("The optional prospect name is not reaching the meeting title.");
}
// A short transcript has to be refused HERE, where the person is looking at a
// screen, not downstream where it becomes a No show row they never see.
const short = { ...meeting, transcript: [{ text: "hello" }] };
try {
  run({ recording: "175005047" }, Object.fromEntries(sourceNames.map((n, i) => [n, i === 0 ? [short] : []])));
  fail(`A recording under ${floor.words} words was accepted; the tracker will file it as a no-show.`);
} catch (err) {
  if (!/nothing to score/.test(err.message)) throw err;
}
// A missing key must name itself. This is the failure the form will actually
// hit, and "could not find that recording" on its own sends someone hunting
// for a bad ID that is not the problem.
try {
  run({ recording: "999999999" }, Object.fromEntries(sourceNames.map((n) => [n, []])));
  fail("An unknown recording id did not raise an error.");
} catch (err) {
  for (const name of closers) {
    if (!err.message.includes(name)) {
      fail(`The not-found message does not say what came back from ${name}'s account.`);
    }
  }
}

const outPath = arg("out")
  ? resolve(arg("out"))
  : join(ROOT, "automation", "generated", `score-this-call-${client}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(configured, null, 2) + "\n");

console.log(`✓ Wrote ${outPath}`);
console.log(`  workflow name:  ${configured.name}`);
console.log(`  form:           ${n8nBase}/form/score-call-${client}`);
console.log(`  posts to:       ${webhook}`);
console.log(`  closers:        ${closers.join(", ")}  (one Fathom credential each)`);
console.log(`  window:         last ${days} days`);
console.log(`  transcript floor: ${floor.words} words, read from the tracker's Has Transcript? gate`);
console.log("\nImport it into n8n, attach one Fathom HTTP Header Auth credential per");
console.log('"Ask Fathom - …" node (header X-Api-Key), then switch it on.');
console.log("The tracker's untracked-call alert already links to this form.");
