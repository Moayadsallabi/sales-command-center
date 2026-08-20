// Which recordings the automation agrees to score — read out of the client's
// own generated workflow, never restated.
//
// WHY THIS IS A SHARED FILE RATHER THAN A COPY IN EACH SCRIPT
//
// On 18 August 2026 the rule stopped being a list of "contains" rows and
// became a single expression, because n8n applies one and/or across a
// condition list and a list therefore cannot say "any of these phrases, but
// never any of those". Everything that read the old shape had to change with
// it. check-delivery.mjs and the filter test did. backfill-fathom.mjs did not:
// it went on reading `rightValue` off each condition, which the new shape
// leaves empty, so it refused to run at all with "Found no call phrases" —
// a message pointing at the client's workflow for a fault in the reader.
//
// One reader, one place to change. Anything that needs to know what the
// automation would do with a title asks here and gets the expression that is
// actually running.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NODE = "Is Sales Call?";

/** Carries the operator-facing next step, so callers can print it as a hint. */
export class SalesCallFilterError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = "SalesCallFilterError";
    this.hint = hint;
  }
}

export function workflowPathFor(client, root = ROOT) {
  return join(root, "automation", "generated", `sales-call-tracker-${client}.json`);
}

/**
 * The literal phrase lists inside the expression, FOR DISPLAY ONLY.
 *
 * Never decide anything with these. The expression is the rule; this is a way
 * to print it to a human without making them read JavaScript. It returns null
 * the moment the expression stops looking like the one the generator writes,
 * which is the honest answer — a half-parsed rule shown as a full one is how
 * the reader and the runner drift apart in the first place.
 */
export function phraseListsIn(expression) {
  const grab = (name) => {
    const m = expression.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`));
    if (!m) return null;
    try {
      const list = JSON.parse(m[1]);
      return Array.isArray(list) ? list : null;
    } catch {
      return null;
    }
  };
  const sales = grab("sales");
  const blocked = grab("blocked");
  return sales ? { sales, blocked: blocked ?? [] } : null;
}

/**
 * Read one client's live sales-call rule.
 *
 * Returns the expression, the file it came from, and a decider that runs it
 * against a meeting title exactly as n8n would — the workflow reads
 * `$json.body.meeting_title`, and the webhook body is the Fathom meeting
 * object, so a title is enough for the title rule.
 */
export function readSalesCallFilter(client, { root = ROOT } = {}) {
  const path = workflowPathFor(client, root);

  let workflow;
  try {
    workflow = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new SalesCallFilterError(
      `No generated workflow for "${client}" at ${path}.`,
      "Run configure:client for them first, so this reads the rule that is actually running.",
    );
  }

  const node = workflow.nodes?.find((n) => n.name === NODE);
  if (!node) {
    throw new SalesCallFilterError(
      `${path} has no "${NODE}" node.`,
      "That file is not a sales-call tracker workflow, or it predates the node being named.",
    );
  }

  const conditions = node.parameters?.conditions?.conditions ?? [];
  const expressionOf = (c) => (typeof c?.leftValue === "string" ? c.leftValue : "");
  if (conditions.length !== 1 || !expressionOf(conditions[0]).startsWith("={{")) {
    // The old shape, and worth naming precisely: it is not corrupt, it is out
    // of date, and it will happily match the wrong calls if anyone rebuilds
    // from it — "Funded Blueprint Onboarding Call" contains "Funded Blueprint".
    throw new SalesCallFilterError(
      `The "${NODE}" node in ${path} is a list of conditions, not the single expression this expects.`,
      "That file was generated before 18 August 2026, when exclusions started winning over\n" +
        "  phrases. Re-run configure:client for this client — the old shape scores onboarding\n" +
        "  calls as sales.",
    );
  }

  const expression = expressionOf(conditions[0])
    .replace(/^=\{\{/, "")
    .replace(/\}\}$/, "");

  let decide;
  try {
    decide = new Function("$json", `return (${expression});`);
  } catch (err) {
    throw new SalesCallFilterError(
      `The sales-call expression in ${path} will not parse: ${err.message}`,
      "Regenerate it with configure:client rather than editing the file by hand.",
    );
  }

  return {
    path,
    expression,
    /** What the automation would do with this title. `body` adds fields such as force_score. */
    isSalesCall(title, body = {}) {
      return decide({ body: { ...body, meeting_title: title ?? "" } }) === true;
    },
  };
}
