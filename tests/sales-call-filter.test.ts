/**
 * Which recordings the automation agrees to score.
 *
 * Read out of the generated workflow rather than restated here, so this tests
 * the rule that actually runs. Every case below is a real meeting title from
 * Brey's calendar or recorder.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const workflow = JSON.parse(
  readFileSync(resolve(__dirname, "../automation/generated/sales-call-tracker-brey.json"), "utf8")
);

const expr = workflow.nodes
  .find((n: { name: string }) => n.name === "Is Sales Call?")
  .parameters.conditions.conditions[0].leftValue.replace(/^=\{\{/, "").replace(/\}\}$/, "");

const scores = (title: string): boolean =>
  new Function("$json", `return (${expr});`)({ body: { meeting_title: title } });

describe("calls the automation scores", () => {
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

describe("calls it must never score", () => {
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

describe("a recording with no usable name", () => {
  it("is not scored, so an onboarding call cannot be filed as a sale", () => {
    // Google names an ad-hoc call this. It carries no evidence of what kind of
    // call it was, so it takes the false branch into the Slack queue and a
    // person decides. Denis's closed deal and Angel's were both this shape —
    // the answer is a human, not a guess.
    expect(scores("Impromptu Google Meet Meeting")).toBe(false);
    expect(scores("")).toBe(false);
  });
});
