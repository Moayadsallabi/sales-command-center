// Evaluates the generated n8n workflow's expressions against a mock Fathom
// payload, so a syntax error or a wrong field name fails here instead of in
// production on a real sales call.
//
// Run with: npm run check:workflow

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = JSON.parse(
  readFileSync(join(root, "automation/sales-call-tracker.json"), "utf8")
);
const rubric = JSON.parse(readFileSync(join(root, "rubric/rubric.json"), "utf8"));

let failures = 0;
const fail = (msg) => {
  console.error(`  FAIL  ${msg}`);
  failures++;
};
const pass = (msg) => console.log(`  ok    ${msg}`);

const nodeByName = Object.fromEntries(workflow.nodes.map((n) => [n.name, n]));

/** Strip n8n's `={{ … }}` wrapper and evaluate the JS inside. */
function evalExpr(expr, scope) {
  const inner = expr.replace(/^=\{\{/, "").replace(/\}\}$/, "");
  const fn = new Function("$json", "$", `return (${inner});`);
  return fn(scope.$json, scope.$);
}

/* ------------------------------------------------- mock upstream node data */

const longTranscript = Array.from(
  { length: 40 },
  (_, i) => `Closer: Question number ${i}?\nAlex Morgan: A considered answer to number ${i}.`
).join("\n");

const mockDirect = {
  call_date: "2026-08-11",
  prospect_name: "Alex Morgan",
  prospect_email: "alex@prospect.com",
  duration_minutes: 47,
  share_url: "https://fathom.video/share/example",
  transcript: longTranscript,
  attendees: "Sam Rep <sam@agency.com>, Alex Morgan <alex@prospect.com>",
  external_attendees: "Alex Morgan <alex@prospect.com>",
  closer: "Sam Rep",
  recording_id: 987654,
};

const mockAi = {
  outcome: "Customer",
  tier: 2,
  price_discussed: 9000,
  price_closed: 9000,
  collected_on_call: 4500,
  // Deliberately not the default currency, so a workflow that drops the field
  // or hardcodes USD fails here rather than on a real euro deal.
  currency: "EUR",
  payment_structure: "installments",
  prospect_revenue: "40k/mo",
  niche: "Trading education",
  location: "Dubai",
  lead_source: "IG",
  summary: "Alex closed on tier 2 with a two-part payment.",
  // One unassessed score, sent as 0 — which is what the schema now demands and
  // therefore what a real call sends. The average must skip it, and it must
  // reach Notion as an empty cell, not as a zero out of ten.
  scores: Object.fromEntries(
    rubric.dimensions.map((d, i) => [
      d.key,
      i === rubric.dimensions.length - 1
        ? { score: 0, reasoning: `No evidence for ${d.name} on this call.` }
        : { score: 7, reasoning: `Reasoning for ${d.name}.` },
    ])
  ),
  // Every factor at half its ceiling except the last, which is unassessed — so
  // the Lead Score must come out of the seven that scored, not all eight.
  lead_quality: Object.fromEntries(
    rubric.leadQuality.factors.map((f, i) => [
      f.key,
      i === rubric.leadQuality.factors.length - 1
        ? { score: 0, reasoning: `${f.name} never came up.` }
        : { score: Math.round(f.max / 2), reasoning: `Reasoning for ${f.name}.` },
    ])
  ),
  objections: {
    raised: ["Price", "Partner"],
    primary: "Price",
    detail: "Price landed hard at [21:04] and was never isolated from the partner question.",
  },
  flags: {
    value_leak: false,
    follow_up_trap: false,
    price_drop_too_early: true,
    weakest_belief: "Money",
  },
  narrative: {
    best_moment: "Held silence for nine seconds after the price.",
    biggest_miss: "Never asked about the business partner.",
    the_moment: "At the price drop, the caller filled the silence.",
    next_call_drill: "After the price, count to five before speaking.",
    lead_read: "Believes the method, doubts himself. Needs proof before price.",
  },
};

/* -------------------------------------------------------- 1. Load Rubric */

const loadRubric = nodeByName["Load Rubric"];
const rubricFields = Object.fromEntries(
  loadRubric.parameters.assignments.assignments.map((a) => [a.name, a.value])
);

if (rubricFields.system_prompt.includes("__SYSTEM_PROMPT__")) {
  fail("Load Rubric still holds the __SYSTEM_PROMPT__ placeholder — run `npm run build:rubric`");
} else if (rubricFields.system_prompt.length < 2000) {
  fail(`system prompt is suspiciously short (${rubricFields.system_prompt.length} chars)`);
} else {
  pass(`system prompt embedded (${rubricFields.system_prompt.length} chars)`);
}

let schema;
try {
  schema = JSON.parse(rubricFields.output_schema);
  pass("output schema parses");
} catch (err) {
  fail(`output schema is not valid JSON: ${err.message}`);
}

if (schema) {
  const missing = rubric.dimensions
    .map((d) => d.key)
    .filter((k) => !(k in schema.properties.scores.properties));
  if (missing.length) fail(`schema is missing dimensions: ${missing.join(", ")}`);
  else pass(`schema covers all ${rubric.dimensions.length} dimensions`);

  // Structured outputs reject these keywords; catching them here beats a 400.
  const banned = ["minimum", "maximum", "minLength", "maxLength", "multipleOf", "pattern"];
  const found = new Set();
  (function walk(n) {
    if (!n || typeof n !== "object") return;
    for (const [k, v] of Object.entries(n)) {
      if (banned.includes(k)) found.add(k);
      walk(v);
    }
  })(schema);
  if (found.size) fail(`schema uses keywords structured outputs rejects: ${[...found].join(", ")}`);
  else pass("schema uses no unsupported keywords");
}

/* ----------------------------------------------------- 2. Claude Analysis */

const claudeScope = {
  $json: { ...mockDirect, ...rubricFields },
  $: () => ({ item: { json: mockDirect } }),
};

let claudeBody;
try {
  claudeBody = JSON.parse(
    evalExpr(nodeByName["Claude Analysis"].parameters.jsonBody, claudeScope)
  );
  pass("Claude request body builds and is valid JSON");
} catch (err) {
  fail(`Claude request body: ${err.message}`);
}

if (claudeBody) {
  if (claudeBody.model !== "claude-opus-5") fail(`unexpected model: ${claudeBody.model}`);
  else pass(`model is ${claudeBody.model}`);

  if (claudeBody.output_config?.format?.type !== "json_schema")
    fail("structured outputs are not configured");
  else pass("structured outputs configured");

  if (!claudeBody.messages?.[0]?.content?.includes(mockDirect.transcript))
    fail("transcript is missing from the user message");
  else pass("transcript reaches the user message");

  if (!claudeBody.messages?.[0]?.content?.includes(mockDirect.closer))
    fail("closer is missing from the user message");
  else pass("closer reaches the user message");
}

/* --------------------------------------- 2b. Dedupe and no-transcript gates */

const dedupeScope = {
  $json: mockDirect,
  $: () => ({ item: { json: mockDirect } }),
};

try {
  const body = JSON.parse(
    evalExpr(nodeByName["Already Logged?"].parameters.jsonBody, dedupeScope)
  );
  if (body.filter?.property !== "Recording ID" || body.filter?.number?.equals !== mockDirect.recording_id)
    fail("dedupe query does not filter on Recording ID");
  else pass("dedupe query filters on Recording ID");
} catch (err) {
  fail(`dedupe query body: ${err.message}`);
}

const isNewExpr = nodeByName["Is New Call?"].parameters.conditions.conditions[0].leftValue;
try {
  const fresh = evalExpr(isNewExpr, { $json: { results: [] }, $: () => ({}) });
  const dupe = evalExpr(isNewExpr, { $json: { results: [{ id: "existing" }] }, $: () => ({}) });
  if (fresh !== true || dupe !== false) fail("Is New Call? gate gives the wrong answer");
  else pass("Is New Call? passes a fresh recording and blocks a duplicate");
} catch (err) {
  fail(`Is New Call? expression: ${err.message}`);
}

const hasTranscriptExpr =
  nodeByName["Has Transcript?"].parameters.conditions.conditions[0].leftValue;
try {
  const full = evalExpr(hasTranscriptExpr, {
    $json: {},
    $: () => ({ item: { json: mockDirect } }),
  });
  const empty = evalExpr(hasTranscriptExpr, {
    $json: {},
    $: () => ({ item: { json: { ...mockDirect, transcript: "Closer: Hello? Anyone there?" } } }),
  });
  if (full !== true || empty !== false) fail("Has Transcript? gate gives the wrong answer");
  else pass("Has Transcript? scores a real transcript and diverts an empty one");
} catch (err) {
  fail(`Has Transcript? expression: ${err.message}`);
}

try {
  const noShow = JSON.parse(
    evalExpr(nodeByName["Log No-Show"].parameters.jsonBody, {
      $json: {},
      $: () => ({ item: { json: mockDirect } }),
    })
  );
  if (noShow.properties?.Outcome?.select?.name !== "No show")
    fail("Log No-Show does not set the outcome to No show");
  else if (noShow.properties?.["Recording ID"]?.number !== mockDirect.recording_id)
    fail("Log No-Show does not write the Recording ID");
  else if (noShow.properties?.["Quality Score"])
    fail("Log No-Show writes a Quality Score — a no-show must stay unscored");
  else pass("Log No-Show writes an unscored row with outcome, closer and Recording ID");
} catch (err) {
  fail(`Log No-Show body: ${err.message}`);
}

/* --------------------------------------------------- 3. Parse AI Response */

const parseExpr = nodeByName["Parse AI Response"].parameters.assignments.assignments[0].value;

// Thinking is enabled, so the first content block is a thinking block. The
// parser must skip it and find the text block.
const withThinking = {
  stop_reason: "end_turn",
  content: [
    { type: "thinking", thinking: "" },
    { type: "text", text: JSON.stringify(mockAi) },
  ],
};
try {
  const parsed = evalExpr(parseExpr, { $json: withThinking, $: () => ({}) });
  if (parsed.outcome !== "Customer") fail("parser returned the wrong object");
  else pass("parser skips the thinking block and finds the text block");
} catch (err) {
  fail(`parser on a normal response: ${err.message}`);
}

try {
  evalExpr(parseExpr, { $json: { stop_reason: "refusal", content: [] }, $: () => ({}) });
  fail("parser silently accepted a refusal instead of erroring");
} catch {
  pass("parser errors on a refusal rather than writing an empty row");
}

/* --------------------------------------------------------- 4. Notion body */

const notionScope = {
  $json: { ai: mockAi },
  $: (name) => {
    if (name === "Extract Direct Fields") return { item: { json: mockDirect } };
    if (name === "Load Rubric")
      return { item: { json: { rubric_version: rubric.version } } };
    throw new Error(`unexpected node reference: ${name}`);
  },
};

let notionBody;
try {
  notionBody = JSON.parse(evalExpr(nodeByName["Write to Notion"].parameters.jsonBody, notionScope));
  pass("Notion request body builds and is valid JSON");
} catch (err) {
  fail(`Notion request body: ${err.message}`);
}

if (notionBody) {
  const props = notionBody.properties;

  if (props.Closer?.select?.name !== "Sam Rep") fail("Closer is not being written");
  else pass("Closer is written as a select");

  if (props.Currency?.select?.name !== "EUR")
    fail("Currency is not being written — money totals would mix currencies");
  else pass("Currency is written as a select");

  // The workflow must never touch `Cash Collected` or `Outstanding`: at scoring
  // time nobody knows what lands later, and writing them would overwrite the
  // figures a human filled in by hand.
  if (props["Collected On Call"]?.number !== 4500)
    fail("Collected On Call is not being written");
  else if ("Cash Collected" in props || "Outstanding" in props)
    fail("workflow writes a hand-maintained payment column");
  else pass("Collected On Call written; hand-maintained payment columns untouched");

  const wrongDims = rubric.dimensions.filter((d, i) => {
    const expected = i === rubric.dimensions.length - 1 ? null : 7;
    return props[d.column]?.number !== expected;
  });
  if (wrongDims.length)
    fail(`dimension columns missing or wrong: ${wrongDims.map((d) => d.column).join(", ")}`);
  else pass(`all ${rubric.dimensions.length} dimension columns written (0 carried as an empty cell)`);

  // Seven 7s and one unassessed must average to 7 — counting the 0 gives 6.1.
  if (props["Quality Score"]?.number !== 7)
    fail(`Quality Score should skip unassessed scores (expected 7, got ${props["Quality Score"]?.number})`);
  else pass("Quality Score averages only the scored dimensions");

  // The join to the KPI dashboard. Without it a call can only be tied to a
  // lead by name and date, which stops working the day two prospects share a
  // first name — and it fails silently, by tying the score to the wrong person.
  if (props["Prospect Email"]?.email !== mockDirect.prospect_email)
    fail(
      `Prospect Email is not written (got ${JSON.stringify(props["Prospect Email"])}) — ` +
        "call scores could not be matched to leads by email"
    );
  else pass("Prospect Email is written");

  if (props["Recording ID"]?.number !== mockDirect.recording_id)
    fail("Recording ID is not written — dedupe has nothing to match against");
  else pass("Recording ID is written");

  const versionText = props["Rubric Version"]?.rich_text?.[0]?.text?.content;
  if (versionText !== rubric.version)
    fail(`Rubric Version should be ${rubric.version}, got ${versionText}`);
  else pass(`Rubric Version ${rubric.version} is written`);

  const factors = rubric.leadQuality.factors;

  const wrongFactors = factors.filter((f, i) => {
    const expected = i === factors.length - 1 ? null : Math.round(f.max / 2);
    return props[f.column]?.number !== expected;
  });
  if (wrongFactors.length)
    fail(`lead factor columns missing or wrong: ${wrongFactors.map((f) => f.column).join(", ")}`);
  else pass(`all ${factors.length} lead factor columns written (null carried as null)`);

  // The denominator must be the ceilings of the factors that scored, not of all
  // of them. Counting the unscored factor's ceiling too would drag this down by
  // several points on every call that ended early.
  const scoredFactors = factors.slice(0, -1);
  const expectedLead = Math.round(
    (scoredFactors.reduce((t, f) => t + Math.round(f.max / 2), 0) /
      scoredFactors.reduce((t, f) => t + f.max, 0)) *
      rubric.leadQuality.max
  );
  const naiveLead = Math.round(
    (scoredFactors.reduce((t, f) => t + Math.round(f.max / 2), 0) / rubric.leadQuality.max) *
      rubric.leadQuality.max
  );
  if (props["Lead Score"]?.number === naiveLead)
    fail(
      `Lead Score counted the unscored factor's ceiling in the denominator ` +
        `(got ${naiveLead}, should be ${expectedLead})`
    );
  else if (props["Lead Score"]?.number !== expectedLead)
    fail(
      `Lead Score should normalise over the scored factors (expected ${expectedLead}, got ${props["Lead Score"]?.number})`
    );
  else pass(`Lead Score normalises over the factors that were scored (${expectedLead}/100)`);

  const objs = props.Objections?.multi_select?.map((o) => o.name) ?? [];
  if (objs.join() !== "Price,Partner")
    fail(`Objections should be a multi-select of what was raised, got ${JSON.stringify(objs)}`);
  else if (props["Primary Objection"]?.select?.name !== "Price")
    fail("Primary Objection is not being written");
  else pass("objections written as a multi-select, with the deciding one named");

  const leadRead = props["Lead Read"]?.rich_text?.[0]?.text?.content;
  if (!leadRead) fail("Lead Read is not being written");
  else pass("Lead Read is written");

  // 1 scorecard heading + a heading and a paragraph per dimension + 1 divider
  // + 3 section headings + 2 narrative paragraphs + 1 lead-quality heading
  // + a bullet per lead factor + 2 lead-read blocks + 2 objection blocks
  // + 1 objection detail paragraph + 6 flag bullets.
  const expectedBlocks =
    1 + rubric.dimensions.length * 2 + 1 + 3 + 2 + 1 + factors.length + 2 + 2 + 1 + 6;
  if (notionBody.children.length !== expectedBlocks)
    fail(`expected ${expectedBlocks} page blocks, got ${notionBody.children.length}`);
  else pass(`${notionBody.children.length} page blocks built`);

  if (notionBody.children.length > 100)
    fail("more than 100 page blocks — Notion rejects that in a single page create");

  const overLong = notionBody.children.filter((b) => {
    const rt = b[b.type]?.rich_text;
    return rt && rt[0]?.text?.content?.length > 2000;
  });
  if (overLong.length) fail(`${overLong.length} blocks exceed Notion's 2000-character limit`);
  else pass("no block exceeds Notion's 2000-character limit");
}

/* ------------------------------------------ 4b. Prospect name extraction */

// Real titles seen in Fathom: "Karan: Strategy Call" (correct), "Alphazone.ai
// Strategy Call" (no colon) and "Impromptu Zoom Meeting" (no invite at all).
// The first is easy; the other two used to produce a row named after the
// meeting, which reads as a real prospect in the table.
const prospectExpr = nodeByName["Extract Direct Fields"].parameters.assignments.assignments.find(
  (a) => a.name === "prospect_name"
).value;

const nameFrom = (title, invitees = []) =>
  evalExpr(prospectExpr, {
    $json: { meeting_title: title },
    $: () => ({ item: { json: { body: { calendar_invitees: invitees } } } }),
  });

const externalInvitee = [{ name: "Alex Morgan", email: "alex@prospect.com", is_external: true }];

if (nameFrom("Alex Morgan: Strategy Call", externalInvitee) !== "Alex Morgan")
  fail("prospect name is not taken from the part before the colon");
else pass("prospect name comes from the title before the colon");

if (nameFrom("Alphazone.ai Strategy Call", externalInvitee) !== "Alex Morgan")
  fail("a title with no colon does not fall back to the external invitee");
else pass("a title with no colon falls back to the external invitee");

if (nameFrom("Impromptu Zoom Meeting", []) !== "Unknown")
  fail("an impromptu call with no invitees is not named Unknown");
else pass("an impromptu call with no invitees is named Unknown");

/* ------------------------------------------- 4c. Untracked recordings */

const untracked = nodeByName["Untracked — Alert"];
if (!untracked) {
  fail("no Untracked — Alert node: unmatched recordings vanish with no trace");
} else if (untracked.type !== "n8n-nodes-base.slack") {
  fail("Untracked — Alert is not a Slack node");
} else if (!JSON.stringify(untracked.parameters).includes("__CLIENT_NAME__")) {
  // Every client posts into one channel, so an unlabelled alert is unactionable.
  fail("Untracked — Alert does not name its client — the __CLIENT_NAME__ placeholder is gone");
} else if (untracked.onError !== "continueRegularOutput") {
  // Otherwise a missing Slack credential fails the branch on every internal meeting.
  fail("Untracked — Alert must not fail its branch: set onError continueRegularOutput");
} else {
  const text = evalExpr(untracked.parameters.text, {
    $json: {},
    $: () => ({
      item: {
        json: {
          body: {
            meeting_title: "Impromptu Zoom Meeting",
            recorded_by: { name: "MomoFX" },
            share_url: "https://fathom.video/share/example",
          },
        },
      },
    }),
  });
  if (!text.includes("Impromptu Zoom Meeting"))
    fail("the untracked alert does not name the recording it skipped");
  else if (!text.includes("https://fathom.video/share/example"))
    fail("the untracked alert does not link the recording");
  else pass("unmatched recordings alert with their client, title and link");
}

const falseBranch = workflow.connections["Is Sales Call?"]?.main?.[1] ?? [];
if (!falseBranch.some((l) => l.node === "Untracked — Alert"))
  fail("the not-a-sales-call branch is not wired to the alert");
else pass("the not-a-sales-call branch reaches the alert");

/* -------------------------------------------------------------- 5. Safety */

const serialised = JSON.stringify(workflow);
for (const [label, pattern] of [
  ["a live Anthropic key", /sk-ant-[A-Za-z0-9]/],
  ["a live Notion token", /\b(ntn_|secret_)[A-Za-z0-9]{10}/],
  ["a hardcoded Notion database id", /"database_id": ?'[0-9a-f]{32}/],
]) {
  if (pattern.test(serialised)) fail(`workflow contains ${label}`);
}
if (workflow.active !== false) fail("workflow ships with active: true");
else pass("workflow ships inactive with no credentials embedded");

// A transient Claude or Notion error must not lose the call.
const needRetry = ["Already Logged?", "Claude Analysis", "Write to Notion", "Log No-Show"];
const noRetry = needRetry.filter((n) => nodeByName[n]?.retryOnFail !== true);
if (noRetry.length) fail(`nodes without retryOnFail: ${noRetry.join(", ")}`);
else pass("every external call retries on failure");

/* ----------------------------------------------------- 6. Error alert flow */

try {
  const alert = JSON.parse(readFileSync(join(root, "automation/error-alert.json"), "utf8"));
  if (!alert.nodes.some((n) => n.type === "n8n-nodes-base.errorTrigger"))
    fail("error-alert.json has no Error Trigger node");
  else if (alert.active !== false) fail("error-alert.json ships active");
  else if (!JSON.stringify(alert).includes("YOUR_ALERT_WEBHOOK_URL"))
    fail("error-alert.json is missing the webhook placeholder — is a real URL embedded?");
  else pass("error alert workflow parses, ships inactive, webhook is a placeholder");
} catch (err) {
  fail(`error-alert.json: ${err.message}`);
}

console.log(failures === 0 ? "\nAll workflow checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
