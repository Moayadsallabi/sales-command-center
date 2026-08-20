/**
 * Which recordings the automation agrees to score.
 *
 * Read out of the generated workflow rather than restated here, so this tests
 * the rule that actually runs. Every case below is a real meeting title from
 * Brey's calendar or recorder.
 */
import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
// Plain JS, shared with the scripts that read the same rule.
import { readSalesCallFilter } from "../scripts/lib/sales-call-filter.mjs";

// `automation/generated/` is gitignored — it carries the client's real Notion
// database id and offer context. So these tests only run where that client has
// been configured, and say why when they cannot, rather than failing with a
// stack trace on a fresh clone.
const configured = existsSync(
  resolve(__dirname, "../automation/generated/sales-call-tracker-brey.json")
);

const filter = configured ? readSalesCallFilter("brey") : null;
const scores = (title: string, body: Record<string, unknown> = {}): boolean =>
  filter!.isSalesCall(title, body);

describe.skipIf(!configured)("calls the automation scores", () => {
  const sales = [
    "Justin : Profitability Game Plan Call",
    "Nicole O.: Profitability Game Plan Call Team",
    "sushantt_05: Profitability Game Plan Call Tpan",
    "Profitability Game Plan Call.",
    "Profitability Game Plan Session",
    "The Funded Blueprint Enrollment Call",
    "THE FUNDED BLUEPRINT",
    "THE FUNDED BLUEPRINT (STRATEGY SESSION)",
    " The Funded Blueprint — Strategy Call",
  ];
  it.each(sales)("scores %s", (title) => {
    expect(scores(title)).toBe(true);
  });

  it("ignores capitals, because invites are typed in a hurry", () => {
    expect(scores("profitability game plan call")).toBe(true);
  });
});

describe.skipIf(!configured)("calls it must never score", () => {
  it("blocks onboarding even though the name contains a sales phrase", () => {
    // THE case a plain include-list gets wrong: "Funded Blueprint Onboarding
    // Call" contains "Funded Blueprint". A post-sale call scored as a sale
    // inflates the close rate and puts revenue against the wrong call.
    expect(scores("Funded Blueprint Onboarding Call")).toBe(false);
    expect(scores("Profitability Game Plan Call — Onboarding")).toBe(false);
  });

  it("blocks internal meetings", () => {
    expect(scores("Team Meeting")).toBe(false);
    expect(scores("Standup")).toBe(false);
  });

  it("blocks the delivery team's generic link", () => {
    // Three bookings, all one customer who had already bought.
    expect(scores("30 Minute Meeting")).toBe(false);
  });
});

describe.skipIf(!configured)("a recording with no usable name", () => {
  it("is not scored, so an onboarding call cannot be filed as a sale", () => {
    // Google names an ad-hoc call this. It carries no evidence of what kind of
    // call it was, so it takes the false branch into the Slack queue and a
    // person decides. Denis's closed deal and Angel's were both this shape —
    // the answer is a human, not a guess.
    expect(scores("Impromptu Google Meet Meeting")).toBe(false);
    expect(scores("")).toBe(false);
  });
});

describe.skipIf(!configured)("a call a person has vouched for", () => {
  // The form at /form/score-call-brey exists for exactly the calls this rule
  // cannot recognise: an impromptu recording with no invite to take a title
  // from. A person reads the Slack alert, decides it was a sales call, and the
  // form re-posts it with force_score set. Without this branch that form is a
  // button that does nothing.
  it("is scored even though its title matches nothing", () => {
    expect(scores("Impromptu Google Meet Meeting")).toBe(false);
    expect(scores("Impromptu Google Meet Meeting", { force_score: true })).toBe(true);
  });

  it("cannot be used to force an onboarding call through", () => {
    // The blocks come first on purpose. A human ticking a box is not a reason
    // to file a post-sale onboarding call as a sale.
    expect(scores("Funded Blueprint Onboarding Call", { force_score: true })).toBe(false);
  });

  it("is not triggered by the string 'true', only the boolean", () => {
    expect(scores("Impromptu Google Meet Meeting", { force_score: "true" })).toBe(false);
  });
});
