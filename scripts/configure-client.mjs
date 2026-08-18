// Turns the master workflow into a ready-to-import copy for one client, doing
// every substitution the setup manual asks you to make by hand in n8n. Hand
// editing eight boxes is where client onboarding goes wrong: a database id
// pasted into two of three nodes, or a call phrase whose capitals do not match,
// both fail quietly. Every substitution here is asserted before the file is
// written, so a miss is an error rather than a workflow that half-works.
//
// Pass --phrase once per phrase the client uses. Any one of them marks a
// meeting as a sales call, and capitals are ignored, so an invite typed in a
// hurry still gets tracked.
//
// Pass --exclude for anything that must NEVER be scored however it is named —
// onboarding, team meetings, internal syncs. EXCLUSIONS WIN over phrases, which
// matters more than it sounds: "Funded Blueprint Onboarding Call" contains
// "Funded Blueprint", so without a hard block the onboarding call is scored as
// a sale. Name the sales calls, then block the rest.
//
//   npm run configure:client -- \
//     --client brey \
//     --name "Brey" \
//     --database 3baa6b94d53c809884c0ffa089665938 \
//     --phrase "Strategy Call" --phrase "Discovery Call" --phrase "Sales Call" \
//     --exclude "Onboarding" --exclude "Team Meeting" \
//     --channel "brey-sales-alerts" \
//     --offer rubric/clients/brey.local.md
//
// Import the written file into n8n, attach that client's Notion credential and
// the shared Anthropic one, then switch it on.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { buildSystemPrompt, buildOutputSchema } from "./build-rubric.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MASTER = join(ROOT, "automation", "sales-call-tracker.json");
const RUBRIC = join(ROOT, "rubric", "rubric.json");

const DB_PLACEHOLDER = "YOUR_NOTION_DATABASE_ID";
const OFFER_HEADING = "## The offer being sold\n\n";
const OFFER_NEXT_HEADING = "\n\n## How to score";

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

/** Every value passed for a repeatable option, in the order given. */
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
const database = arg("database");
const phrases = argAll("phrase");
const excludes = argAll("exclude");
const offerPath = arg("offer");
const display = arg("name") ?? client;
const currency = arg("currency");
const channel = arg("channel");
const tierCount = arg("tiers");

if (!client || !database || !phrases.length || !offerPath) {
  fail(
    "Missing required option.",
    "Needs --client, --database, --phrase and --offer. See the header of this file."
  );
}

// The slug becomes a webhook path, so it has to survive being in a URL.
if (!/^[a-z0-9-]+$/.test(client)) {
  fail(`--client "${client}" must be lowercase letters, numbers and dashes only.`);
}

const databaseId = database.replace(/-/g, "");
if (!/^[0-9a-f]{32}$/i.test(databaseId)) {
  fail(`--database "${database}" is not a 32-character Notion id.`);
}

let offer;
try {
  offer = readFileSync(resolve(offerPath), "utf8").trim();
} catch {
  fail(`Could not read the offer file at "${offerPath}".`);
}
if (offer.length < 80) {
  // A one-liner here produces a scorer with no idea what a good pitch sounds
  // like, and every pitch_precision score becomes noise.
  fail(
    `The offer description is only ${offer.length} characters.`,
    "Write two or three sentences: what they sell, to whom, at what prices."
  );
}

// The rubric, with this client's own money shape applied to it.
//
// Both of these were previously fixed for everyone at whatever the master
// rubric said, which is how a client selling in pounds got every unstated
// price recorded as dollars, and how a client with three price bands had the
// third one filed under one of the other two.
const rubric = JSON.parse(readFileSync(RUBRIC, "utf8"));

if (currency) {
  const code = currency.toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    fail(`--currency "${currency}" should be a three-letter code, such as GBP.`);
  }
  // The default has to be one of the offered options, or the scorer is told to
  // answer with something the schema will not accept.
  rubric.commercial.currencies = [
    code,
    ...rubric.commercial.currencies.filter((c) => c !== code),
  ];
  rubric.commercial.defaultCurrency = code;
}

if (tierCount) {
  const n = Number(tierCount);
  if (!Number.isInteger(n) || n < 1 || n > 6) {
    fail(`--tiers "${tierCount}" should be a whole number of price bands, 1 to 6.`);
  }
  rubric.commercial.tiers = Array.from({ length: n }, (_, i) => i + 1);
}

const systemPrompt = buildSystemPrompt(rubric);
const outputSchema = buildOutputSchema(rubric);

const workflow = JSON.parse(readFileSync(MASTER, "utf8"));
workflow.name = `Sales Call Tracker — ${display}`;

const nodeBy = (name) => {
  const node = workflow.nodes.find((n) => n.name === name);
  if (!node) fail(`The master workflow has no "${name}" node.`, "Has automation/ been regenerated?");
  return node;
};

// 1. Their calls arrive at their own door, not another client's.
nodeBy("Fathom Webhook").parameters.path = `fathom-webhook-${client}`;

// 2. The phrases that decide whether a meeting is a sales call at all. Any one
// of them is enough, and capitals are ignored — a client who types "strategy
// call" in an invite should not silently lose the call.
//
// ONE EXPRESSION RATHER THAN A LIST OF "contains" ROWS.
//
// n8n applies a single and/or across a condition list, so a list cannot say
// "any of these phrases, BUT never any of those". It has to be one test.
// Without the block half, a partial match is enough to score the wrong call:
// "Funded Blueprint Onboarding Call" contains "Funded Blueprint".
//
// A title matching nothing at all — Google Meet names an ad-hoc call
// "Impromptu Google Meet Meeting" — is NOT scored and NOT silently dropped.
// It takes the false branch into the Slack alert, where a person decides. That
// is deliberate: a generic title carries no evidence of what kind of call it
// was, and guessing would file onboarding calls as sales.
const filter = nodeBy("Is Sales Call?").parameters.conditions;
filter.options.caseSensitive = false;
filter.combinator = "and";
const literal = (list) => JSON.stringify(list.map((t) => t.toLowerCase()));
filter.conditions = [
  {
    id: "meeting-title-filter",
    leftValue:
      "={{ (() => {" +
      ' const title = String($json.body.meeting_title || "").toLowerCase();' +
      ` const blocked = ${literal(excludes)};` +
      " if (blocked.some((b) => title.includes(b))) return false;" +
      ` const sales = ${literal(phrases)};` +
      " return sales.some((s) => title.includes(s));" +
      " })() }}",
    rightValue: "",
    operator: { type: "boolean", operation: "true", singleValue: true },
  },
];

// 3. The prompt and the schema, rebuilt for this client's money shape, with
//    the offer paragraph the scorer judges "was this pitch on-message?" against.
const assignments = nodeBy("Load Rubric").parameters.assignments.assignments;
const assign = (name, value) => {
  const a = assignments.find((x) => x.name === name);
  if (!a) fail(`The Load Rubric node has no ${name} assignment.`);
  a.value = value;
};

const start = systemPrompt.indexOf(OFFER_HEADING);
const end = systemPrompt.indexOf(OFFER_NEXT_HEADING);
if (start === -1 || end === -1 || end <= start) {
  fail(
    "Could not find the offer-context block in the rubric prompt.",
    "The prompt's headings changed — update OFFER_HEADING in this script."
  );
}
assign(
  "system_prompt",
  systemPrompt.slice(0, start + OFFER_HEADING.length) +
    offer +
    systemPrompt.slice(end)
);
// Kept as a string for the same reason build:rubric does — the HTTP node parses
// it back, and n8n mangles a deeply nested object on the way through.
assign("output_schema", JSON.stringify(outputSchema));

// 4. Every client's workflow alerts into the same Slack channel, so the message
// has to say whose tracker it came from or you cannot act on it.
const alert = nodeBy("Untracked — Alert");

// THE ALERT MUST POINT AT A CHANNEL THAT EXISTS.
//
// Brey's ran for weeks posting to "sales-tracker". Slack answered
// `channel_not_found` every time and n8n recorded the run as a SUCCESS, so
// every rejected call went nowhere and nothing said so. The queue looked empty
// because it was broken, not because it was clear — and an empty queue is
// exactly what a working one looks like.
//
// `channel_not_found` does NOT mean the channel is missing. Authentication had
// already succeeded by the time Slack looked, so the credential is fine; the
// cause is the channel being in another workspace, the app not being a member
// of it, or the app lacking the scope to resolve a channel by NAME. The last
// one is the trap, because the channel can exist and the app can be in it and
// it still fails. Prefer the channel ID over its name.
//
// The template's value is treated as a placeholder, not a default.
const TEMPLATE_CHANNEL = "sales-tracker";
if (!channel && alert.parameters.channelId?.value === TEMPLATE_CHANNEL) {
  fail(
    `--channel is required: the template's "${TEMPLATE_CHANNEL}" is a placeholder, not a real channel.`,
    "Pass the channel these alerts should land in, and invite the n8n Slack app to it.\n" +
      "  A wrong name here fails silently — Slack refuses and n8n still calls the run a success."
  );
}
if (channel) {
  alert.parameters.channelId = {
    __rl: true,
    value: channel.replace(/^#/, ""),
    mode: "name",
  };
}

if (!JSON.stringify(alert.parameters).includes("__CLIENT_NAME__")) {
  fail(
    "The Untracked — Alert node has no __CLIENT_NAME__ placeholder.",
    "Every alert must name its client — check the workflow template."
  );
}
alert.parameters.text = alert.parameters.text.split("__CLIENT_NAME__").join(display);

// 5. The database id, in all three Notion nodes at once.
const serialised = JSON.stringify(workflow);
const occurrences = serialised.split(DB_PLACEHOLDER).length - 1;
if (occurrences !== 3) {
  fail(
    `Expected 3 database-id placeholders, found ${occurrences}.`,
    "Write to Notion, Already Logged? and Log No-Show should each have one."
  );
}
const configured = JSON.parse(serialised.split(DB_PLACEHOLDER).join(databaseId));

// Nothing below this line should still look like the master copy.
const finalText = JSON.stringify(configured);
if (finalText.includes(DB_PLACEHOLDER)) fail("A database-id placeholder survived.");
if (finalText.includes("[OFFER CONTEXT")) fail("The offer placeholder survived.");
if (finalText.includes("__CLIENT_NAME__")) fail("The client-name placeholder survived.");
if (configured.nodes.find((n) => n.name === "Fathom Webhook").parameters.path !== `fathom-webhook-${client}`) {
  fail("The webhook path did not take.");
}
// The filter is one expression, so it is checked by RUNNING it rather than by
// reading it back. Three cases, because each has cost a real call: a named
// sales call must pass; an excluded one must fail EVEN THOUGH it contains a
// sales phrase, which is the case a plain include-list gets wrong; and a
// generic ad-hoc title must fail, so it lands in the Slack queue for a person
// rather than being scored as a sale on no evidence.
const liveFilter = configured.nodes.find((n) => n.name === "Is Sales Call?").parameters.conditions;
const decide = (title) => {
  const inner = liveFilter.conditions[0].leftValue
    .replace(/^=\{\{/, "")
    .replace(/\}\}$/, "");
  return new Function("$json", `return (${inner});`)({ body: { meeting_title: title } });
};
for (const phrase of phrases) {
  if (!decide(`${phrase} with a prospect`)) {
    fail(`"${phrase}" is not recognised as a sales call.`);
  }
}
for (const blocked of excludes) {
  if (decide(`${phrases[0]} ${blocked}`)) fail(`"${blocked}" is not being blocked.`);
}
if (decide("Impromptu Google Meet Meeting")) {
  fail("An untitled ad-hoc meeting is being scored instead of raised for review.");
}
if (liveFilter.options.caseSensitive !== false) fail("Case sensitivity is still on.");

// The money shape actually took. A silent miss here is the expensive kind:
// nothing looks wrong until a quarter of totals have been added up in the
// wrong currency, or a whole price band has been filed under the wrong label.
const liveRubric = configured.nodes.find((n) => n.name === "Load Rubric")
  .parameters.assignments.assignments;
const liveSchema = JSON.parse(
  liveRubric.find((a) => a.name === "output_schema").value
);
const livePrompt = liveRubric.find((a) => a.name === "system_prompt").value;

if (String(liveSchema.properties.currency.enum[0]) !== rubric.commercial.defaultCurrency) {
  fail("The currency did not take in the output schema.");
}
if (!livePrompt.includes(`answer ${rubric.commercial.defaultCurrency}`)) {
  fail("The currency default did not take in the prompt.");
}
// `tier` is only in the schema for a client whose offers actually come in
// bands — Brey's were removed on 2026-08-18, and the generator drops the field
// entirely when `commercial.tiers` is empty. This assertion used to read
// `.tier.anyOf` unconditionally and crashed for every tier-less client, which
// made configure:client unusable rather than reporting anything.
if (rubric.commercial.tiers.length) {
  const liveTiers = liveSchema.properties.tier?.anyOf?.find((s) => s.enum)?.enum ?? [];
  if (liveTiers.join(",") !== rubric.commercial.tiers.join(",")) {
    fail(`The tiers did not take — schema has ${liveTiers.join(", ") || "none"}.`);
  }
} else if (liveSchema.properties.tier) {
  fail("This client has no price bands, but the schema still asks the scorer for a tier.");
}

const outPath = arg("out")
  ? resolve(arg("out"))
  : join(ROOT, "automation", "generated", `sales-call-tracker-${client}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(configured, null, 2));

console.log(`✓ Wrote ${outPath}`);
console.log(`  workflow name:  ${configured.name}`);
console.log(`  webhook path:   fathom-webhook-${client}`);
console.log(`  call phrases:   ${phrases.map((p) => `"${p}"`).join(", ")} (any, capitals ignored)`);
console.log(`  database id:    ${databaseId} (3 nodes)`);
console.log(`  offer context:  ${offer.length} characters`);
console.log(
  `  currency:       ${rubric.commercial.defaultCurrency} when the call does not say` +
    `${currency ? "" : "  (default — pass --currency to change)"}`
);
console.log(
  `  price bands:    ${rubric.commercial.tiers.length}` +
    `${tierCount ? "" : "  (default — pass --tiers to change)"}`
);
if (rubric.commercial.tiers.length > 2 || currency) {
  console.log(
    `\n  Set the dashboard's NEXT_PUBLIC_REPORTING_CURRENCY to ${rubric.commercial.defaultCurrency},` +
      `\n  and make sure Notion's Tier column offers ${rubric.commercial.tiers
        .map((t) => `Tier ${t}`)
        .join(", ")}.`
  );
}
console.log("\nImport it into n8n, attach the client's Notion credential and the");
console.log("shared Anthropic one, set the Error Workflow, then switch it on.");
