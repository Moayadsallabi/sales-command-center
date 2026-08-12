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

const mockDirect = {
  call_date: "2026-08-11",
  prospect_name: "Alex Morgan",
  duration_minutes: 47,
  share_url: "https://fathom.video/share/example",
  transcript: "Closer: Thanks for jumping on.\nAlex Morgan: No problem.",
  attendees: "Sam Rep <sam@agency.com>, Alex Morgan <alex@prospect.com>",
  external_attendees: "Alex Morgan <alex@prospect.com>",
  closer: "Sam Rep",
};

const mockAi = {
  outcome: "Customer",
  tier: 2,
  price_discussed: 9000,
  price_closed: 9000,
  cash_collected: 4500,
  payment_structure: "installments",
  prospect_revenue: "40k/mo",
  niche: "Trading education",
  location: "Dubai",
  lead_source: "IG",
  summary: "Alex closed on tier 2 with a two-part payment.",
  scores: Object.fromEntries(
    rubric.dimensions.map((d) => [d.key, { score: 7, reasoning: `Reasoning for ${d.name}.` }])
  ),
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
    if (name !== "Extract Direct Fields") throw new Error(`unexpected node reference: ${name}`);
    return { item: { json: mockDirect } };
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

  const missingDims = rubric.dimensions.filter((d) => props[d.column]?.number !== 7);
  if (missingDims.length)
    fail(`dimension columns missing or wrong: ${missingDims.map((d) => d.column).join(", ")}`);
  else pass(`all ${rubric.dimensions.length} dimension columns written`);

  if (props["Quality Score"]?.number !== 7)
    fail(`Quality Score should hold the average (expected 7, got ${props["Quality Score"]?.number})`);
  else pass("Quality Score holds the overall average");

  // 1 scorecard heading + a heading and a paragraph per dimension + 1 divider
  // + 3 section headings + 2 narrative paragraphs + 6 flag bullets.
  const expectedBlocks = 1 + rubric.dimensions.length * 2 + 1 + 3 + 2 + 6;
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

console.log(failures === 0 ? "\nAll workflow checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures ? 1 : 0);
