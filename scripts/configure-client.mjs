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
// Pass --block-offer once per OTHER product the same closers sell. That is a
// different question from --exclude: an excluded call is the wrong KIND of
// meeting and is caught on its title, while a blocked offer is a real sales
// call for somebody else's product and often has no distinguishing title at
// all — so it is caught on the Meeting Purpose line of Fathom's summary
// instead. Omit it and those calls are scored as this client's business.
//
// Pass --no-evidence-fallback for a client whose recorder produces nothing but
// untitled calls. Normally a call with no usable title is judged on its shape
// instead — 15+ minutes with a second voice — which rescues a closer working
// outside the booking link. Where EVERY call is untitled, that test admits the
// team calls too, because the block list reads titles and there are none to
// read. With the flag, an untitled call goes to the Slack alert and is scored
// only when a person vouches for it through the form. See the flag's own note
// below for the volumes that decide which way round is right.
//
// THE ARGUMENTS BELOW ARE THE LIVE ONES FOR BREY. Regenerating without a
// --block-offer that the live workflow has is a silent downgrade: the file
// still builds, still passes every check, and quietly starts scoring another
// offer's calls. If you change them here, change them in n8n too.
//
//   npm run configure:client -- \
//     --client brey \
//     --name "Brey" \
//     --database 3baa6b94d53c809884c0ffa089665938 \
//     --phrase "profitability game plan" \
//     --phrase "funded blueprint enrollment" \
//     --phrase "funded blueprint — strategy" \
//     --phrase "funded blueprint (strategy" \
//     --phrase "the funded blueprint" \
//     --exclude "Onboarding" --exclude "Team Meeting" \
//     --exclude "Standup" --exclude "Internal" \
//     --block-offer "fba" --block-offer "amazon" --block-offer "jp embrace" \
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
const foreignOffers = argAll("block-offer");
const offerPath = arg("offer");
const display = arg("name") ?? client;
const currency = arg("currency");
const channel = arg("channel");
// WHEN THE EVIDENCE TEST HAS NOTHING TO WORK WITH, TURN IT OFF.
//
// An untitled call is normally judged on its shape — 15+ minutes with a voice
// on it that is not the closer's — because at Brey's the untitled ones are
// mostly real sales calls that were started in a bare room, and everything
// else he does is titled ("Team Meeting", "Onboarding") and blocked by name.
//
// That reasoning inverts when a recorder produces NOTHING but untitled calls.
// Moayad starts every Zoom ad hoc, so all 15 of his recordings in one August
// were "Impromptu Zoom Meeting" — his Quran lessons, his strategy calls with
// the team, an onboarding — and the block list, which reads titles, sees none
// of them. Length and a second voice then admit almost every one, and roughly
// one call in nine of his is a sale.
//
// So the fallback is a per-client choice, not a rule: it earns its place where
// the untitled calls are mostly sales, and costs a tracker full of team calls
// where they are mostly not. With it off, an untitled call goes to the Slack
// alert and is scored only if a person vouches for it through the form — the
// same path a blocked call cannot take, since the blocks still win.
//
// THE OBJECTION TO THAT QUEUE STILL STANDS, and this does not answer it in
// general: measured in August 2026 Brey's queue asked for 29 rulings and got
// 3. It is survivable here because the volume is different — Moayad's works
// out at about one call a week — and because the alternative for him is not a
// missed call but a wrong row. A queue nobody works loses calls; a gate that
// admits everything files Quran lessons as sales.
const noEvidenceFallback = process.argv.includes("--no-evidence-fallback");
const tierCount = arg("tiers");
// Every client's workflow lives on Moayad's n8n, not their own, so this is a
// default rather than a required option — but it is overridable, because the
// day it moves the alert links would otherwise all point at nothing.
const n8nBase = arg("n8n") ?? process.env.N8N_BASE_URL ?? "https://moayad.app.n8n.cloud";

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
// "Impromptu Google Meet Meeting" — has no evidence IN THE TITLE, so the
// recording is judged instead: fifteen minutes or more, and a voice on it that
// is not the closer's.
//
// THIS USED TO BE A FLAT REFUSAL, and the refusal went to a Slack queue for a
// person to rule on. Measured on 2026-08-24, across one August that queue asked
// for 29 rulings and was given 3 — and the unread ones included both calls a
// second closer had recorded, so a whole closer was missing from the dashboard
// while the alert worked perfectly. A queue nobody works is not a safety net.
//
// The two signals are what a sales call has and a mis-fire does not. Length
// alone would let in a five-minute no-show and a long internal chat; a second
// voice alone would let in any two-person meeting. The block list is still
// checked FIRST and still wins, which is what keeps a 65-minute "Team Meeting"
// with an outsider on it out — that case was tested against real recordings.
// A call the evidence does not vouch for still goes to the Slack queue.
//
// WHOSE OFFER THE CALL WAS ABOUT, from --block-offer.
//
// A closer who sells a second product books it into the same calendar, because
// the calendar belongs to the closer and not to the product. Nothing else on
// the row distinguishes it: the closer, the price, the outcome and the length
// look identical either way. Widening the gate above to accept ad-hoc calls on
// evidence removed the only protection the block list gave, because that list
// reads TITLES and an ad-hoc call has none — 7 Amazon FBA calls in one August
// would have been scored into a trading tracker.
//
// So this reads the Meeting Purpose line of Fathom's own summary, which is
// reliable for naming a PRODUCT: the seller states it up front and it never
// changes. It is checked before force_score, so a foreign offer cannot be
// waved through, matching how blocked titles behave.
//
// IT READS ONLY THE PURPOSE LINE, AND ONLY FOR PRODUCT NAMES. Do not extend it
// to the word "onboard". Fathom writes the purpose from how a call ENDED, and a
// sales call that CLOSES ends by onboarding the new client, so "Onboard X" is
// what a won deal looks like — that rule refused 10 real closes including two
// at $4,000. Same field, opposite trustworthiness; the counter-example is
// pinned in tests/sales-call-filter.test.ts.
//
// The scorer also returns `offer_match` per call, which catches what a purpose
// line does not name. This gate is the cheap half: it refuses the call before
// it costs a scoring run.
//
// AND A PERSON CAN OVERRULE THE TITLE, BUT ONLY IN ONE DIRECTION.
//
// `force_score` is how the "Score this call" form gets an impromptu recording
// scored: a human reads the Slack alert, decides it was a sales call, and the
// form re-posts the same meeting with that flag set. It is checked AFTER the
// blocks and never before them — vouching for a call is not a reason to file a
// post-sale onboarding call as a sale, and the flag arrives on a webhook body
// that anyone holding the URL can post.
const filter = nodeBy("Is Sales Call?").parameters.conditions;
filter.options.caseSensitive = false;
filter.combinator = "and";
const literal = (list) => JSON.stringify(list.map((t) => t.toLowerCase()));
filter.conditions = [
  {
    id: "meeting-title-filter",
    leftValue:
      "={{ (() => {" +
      " const b = $json.body || {};" +
      ' const title = String(b.meeting_title || "").toLowerCase();' +
      ` const blocked = ${literal(excludes)};` +
      " if (blocked.some((x) => title.includes(x))) return false;" +
      (foreignOffers.length
        ? ' const sum = String(((b.default_summary || {}).markdown_formatted) || "");' +
          " const pm = sum.match(/Meeting Purpose\\s*\\[([^\\]]{0,240})/i);" +
          ' const purpose = String((pm && pm[1]) || "").toLowerCase();' +
          ` const foreign = ${literal(foreignOffers)};` +
          // Word boundaries, not `includes`. "fba" is three letters and would
          // otherwise fire inside an unrelated word, and a false positive here
          // REFUSES a real sales call — the expensive direction to be wrong in.
          ' if (purpose && foreign.some((f) => new RegExp("\\\\b" + f + "\\\\b").test(purpose))) return false;'
        : "") +
      " if (b.force_score === true) return true;" +
      ` const sales = ${literal(phrases)};` +
      " if (sales.some((s) => title.includes(s))) return true;" +
      // Every read below is guarded, because an expression that THROWS inside
      // n8n does not fail loudly — it takes a branch, and the call is gone with
      // no error anyone will see. A missing field must land on `false`.
      (noEvidenceFallback
        ? // Nothing in the title, and this client does not want the shape of the
          // recording to stand in for one. The call is not refused for good —
          // it goes to the Slack alert, and the form can still force it through.
          " return false;"
        : " const mins = (Date.parse(b.recording_end_time) - Date.parse(b.recording_start_time)) / 60000;" +
          " if (!(mins >= 15)) return false;" +
          ' const host = ((b.recorded_by || {}).name) || "";' +
          " const voices = new Set((b.transcript || []).map((t) => (((t || {}).speaker) || {}).display_name).filter(Boolean));" +
          " voices.delete(host);" +
          " return voices.size >= 1;") +
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
// `channel_not_found` does NOT mean the channel is missing, and it is a bad
// error message for what it usually means. Brey's case, resolved 2026-08-18:
// the token was VALID and n8n's own "Test" button said so — it just belonged
// to a different Slack workspace, where that channel id does not exist. The
// app was installed, was in the channel, and had chat:write; none of that
// mattered, because the token was for somewhere else.
//
// The tell was that the credential could not list a single channel. A token
// that is healthy and pointed at the right workspace always sees something.
// If it sees nothing, stop checking the channel and check the workspace.
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
  // An ID is stored as an ID, because the two are not interchangeable. Slack
  // resolves a NAME through a lookup that needs its own scope, and refuses with
  // the same `channel_not_found` whether the channel is missing, the app is not
  // in it, or the app simply cannot list channels. An ID skips the lookup, so a
  // failure with an ID means one of the other two — which is worth knowing when
  // the only symptom you get is that one message.
  const raw = channel.replace(/^#/, "").trim();
  const looksLikeId = /^[CGD][A-Z0-9]{6,}$/.test(raw);
  alert.parameters.channelId = {
    __rl: true,
    value: raw,
    mode: looksLikeId ? "id" : "name",
  };
}

if (!JSON.stringify(alert.parameters).includes("__CLIENT_NAME__")) {
  fail(
    "The Untracked — Alert node has no __CLIENT_NAME__ placeholder.",
    "Every alert must name its client — check the workflow template."
  );
}
alert.parameters.text = alert.parameters.text.split("__CLIENT_NAME__").join(display);

// AN ALERT THAT NAMES A PROBLEM AND NO ACTION GETS READ AND LEFT.
//
// The message used to end with "log it by hand" — a job with no tool, on a
// call nobody could find again without going back through Fathom. It now
// carries the one-field form that re-posts the recording for scoring, with the
// recording id already in the link, so acting on the alert is a click.
const scoreForm = `${n8nBase.replace(/\/+$/, "")}/form/score-call-${client}`;
if (!JSON.stringify(alert.parameters).includes("__SCORE_FORM_URL__")) {
  fail(
    "The Untracked — Alert node has no __SCORE_FORM_URL__ placeholder.",
    "An alert about an untracked call has to say how to get it tracked — check the template.",
  );
}
alert.parameters.text = alert.parameters.text.split("__SCORE_FORM_URL__").join(scoreForm);

// 5. The database id, in all four Notion nodes at once.
//
// THE COUNT IS PART OF THE MASTER WORKFLOW, so adding a Notion node breaks this
// script until someone updates it here. That is the safe direction — a miss
// leaves one node pointed at a placeholder and the workflow half-works — but it
// is only safe if the break is NOTICED. "Still New?" was added on 2026-09-01
// (f467585, the second duplicate check that asks Notion again after scoring)
// and this still said three, so configure:client refused to run for every
// client from that day until 2026-09-05. Nobody found out, because nobody
// regenerates a workflow on an ordinary day — it surfaced only when a new
// client needed one.
//
// If you add another Notion node, change the number and the list below in the
// same commit.
const DB_NODES = ["Write to Notion", "Already Logged?", "Log No-Show", "Still New?"];
const serialised = JSON.stringify(workflow);
const occurrences = serialised.split(DB_PLACEHOLDER).length - 1;
if (occurrences !== DB_NODES.length) {
  fail(
    `Expected ${DB_NODES.length} database-id placeholders, found ${occurrences}.`,
    `${DB_NODES.join(", ")} should each have one.\n` +
      "  A node added to the master since this list was written is the usual cause."
  );
}
const configured = JSON.parse(serialised.split(DB_PLACEHOLDER).join(databaseId));

// Nothing below this line should still look like the master copy.
const finalText = JSON.stringify(configured);
if (finalText.includes(DB_PLACEHOLDER)) fail("A database-id placeholder survived.");
if (finalText.includes("[OFFER CONTEXT")) fail("The offer placeholder survived.");
if (finalText.includes("__CLIENT_NAME__")) fail("The client-name placeholder survived.");
if (finalText.includes("__SCORE_FORM_URL__")) fail("The score-form placeholder survived.");
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
const decide = (title, extra = {}) => {
  const inner = liveFilter.conditions[0].leftValue
    .replace(/^=\{\{/, "")
    .replace(/\}\}$/, "");
  return new Function("$json", `return (${inner});`)({
    body: { ...extra, meeting_title: title },
  });
};
for (const phrase of phrases) {
  if (!decide(`${phrase} with a prospect`)) {
    fail(`"${phrase}" is not recognised as a sales call.`);
  }
}
for (const blocked of excludes) {
  if (decide(`${phrases[0]} ${blocked}`)) fail(`"${blocked}" is not being blocked.`);
}
// An ad-hoc title with nothing behind it must still be refused — no duration,
// no transcript, nothing to vouch for it.
if (decide("Impromptu Google Meet Meeting")) {
  fail("An ad-hoc meeting with no evidence at all is being scored.");
}
// ...and with the evidence, it must be accepted, or a closer who works outside
// the booking link is invisible again.
const adHocEvidence = {
  recording_start_time: "2026-08-23T18:02:00Z",
  recording_end_time: "2026-08-23T19:05:00Z",
  recorded_by: { name: "The Closer" },
  transcript: [
    { speaker: { display_name: "The Closer" } },
    { speaker: { display_name: "A Prospect" } },
  ],
};
if (noEvidenceFallback) {
  // The opposite promise, asserted just as hard. With the fallback off, the
  // shape of a recording vouches for nothing: this call is refused and waits
  // for a person. Asserted rather than assumed because the flag's whole effect
  // is a branch that is not taken, which is invisible in the written file.
  if (decide("Impromptu Google Meet Meeting", adHocEvidence)) {
    fail(
      "--no-evidence-fallback was passed, but a 63-minute ad-hoc call is still being scored. " +
        "The evidence path is still in the expression."
    );
  }
  // And it must still be reachable BY HAND, or the flag has quietly turned the
  // client's untitled calls into calls that can never be scored at all.
  if (!decide("Impromptu Google Meet Meeting", { ...adHocEvidence, force_score: true })) {
    fail("With the evidence path off, the score form is the only way in — and it is refused.");
  }
} else {
  if (!decide("Impromptu Google Meet Meeting", adHocEvidence)) {
    fail("A 63-minute ad-hoc call with a prospect on it is being refused.");
  }
  if (decide("Impromptu Google Meet Meeting", { ...adHocEvidence, transcript: [{ speaker: { display_name: "The Closer" } }] })) {
    fail("A call with nobody but the closer on it is being scored.");
  }
  if (decide("Impromptu Google Meet Meeting", { ...adHocEvidence, recording_end_time: "2026-08-23T18:07:00Z" })) {
    fail("A five-minute ad-hoc call is being scored.");
  }
}
// Every --block-offer name must actually refuse a call, INCLUDING an ad-hoc one
// carrying full evidence — the evidence path is exactly where a foreign offer
// gets in, since those calls rarely have a matching title. And the counter-case
// matters just as much: a purpose line that closes the deal ("Onboard ...") is
// what a WON call looks like, so it must still be scored.
const purposeOf = (line) => ({
  default_summary: { markdown_formatted: `Meeting Purpose [${line}]\n\nNotes...` },
});
for (const offer of foreignOffers) {
  if (decide(`${phrases[0]} with a prospect`, purposeOf(`Discuss the ${offer} programme`))) {
    fail(`"${offer}" is not being refused on the Meeting Purpose line.`);
  }
  // Only meaningful while there IS an evidence path for a foreign offer to get
  // in on. With --no-evidence-fallback every untitled call is refused anyway,
  // so this would pass without testing the purpose check at all — the same
  // unfalsifiable shape as an assertion written where the two populations
  // happen to coincide. The titled case above still exercises it.
  if (!noEvidenceFallback && decide("Impromptu Google Meet Meeting", { ...adHocEvidence, ...purposeOf(`Sell ${offer} coaching`) })) {
    fail(`"${offer}" is getting in on evidence — the purpose check must run before the evidence path.`);
  }
}
if (foreignOffers.length) {
  if (!decide(`${phrases[0]} with a prospect`, purposeOf("Onboard Alan onto the programme"))) {
    fail(
      'A call whose purpose reads "Onboard ..." is being refused. Fathom writes the ' +
        "purpose from how a call ENDED, so that is what a CLOSED deal looks like — " +
        "blocking it deletes real sales. See tests/sales-call-filter.test.ts."
    );
  }
}

// The block list beats the evidence. A long team meeting has both signals.
if (decide(`${excludes[0] ?? "Onboarding"} catch-up`, adHocEvidence)) {
  fail("An excluded call is getting in on evidence — the block list must be checked first.");
}
// A malformed body must land on false rather than throwing, because a throw
// inside an n8n expression is silent.
if (decide("Impromptu Google Meet Meeting", { transcript: null, recorded_by: null })) {
  fail("A body with null fields is being scored instead of refused.");
}
// The form's whole purpose is this branch, and the blocks still have to beat it.
if (!decide("Impromptu Google Meet Meeting", { force_score: true })) {
  fail("A call forced through the score form is still being turned away — the form does nothing.");
}
if (decide(`${phrases[0]} ${excludes[0] ?? "Onboarding"}`, { force_score: true })) {
  fail("An excluded call can be forced through the score form.");
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
console.log(`  database id:    ${databaseId} (${DB_NODES.length} nodes)`);
console.log(`  score form:     ${scoreForm}  (linked from the untracked-call alert)`);
console.log(
  `  untitled calls: ${
    noEvidenceFallback
      ? "alert only — a person vouches for them through the form"
      : "scored when 15+ minutes with a second voice  (pass --no-evidence-fallback to require the form)"
  }`
);
console.log(`  offer context:  ${offer.length} characters`);
console.log(
  `  currency:       ${rubric.commercial.defaultCurrency} when the call does not say` +
    `${currency ? "" : "  (default — pass --currency to change)"}`
);
console.log(
  `  price bands:    ${rubric.commercial.tiers.length}` +
    `${tierCount ? "" : "  (default — pass --tiers to change)"}`
);
// Two separate follow-ups, printed separately. Joined by an `||` they were one
// sentence, so a client with a currency and no price bands was told to make
// sure their Tier column offered "" — an instruction with nothing in it, which
// reads as a bug in the tracker rather than as a line that should not be there.
if (currency) {
  console.log(
    `\n  Set the dashboard's NEXT_PUBLIC_REPORTING_CURRENCY to ${rubric.commercial.defaultCurrency}.`
  );
}
if (rubric.commercial.tiers.length > 2) {
  console.log(
    `\n  Make sure Notion's Tier column offers ${rubric.commercial.tiers
      .map((t) => `Tier ${t}`)
      .join(", ")}.`
  );
}
console.log("\nImport it into n8n, attach the client's Notion credential and the");
console.log("shared Anthropic one, set the Error Workflow, then switch it on.");
