/**
 * The code and the shared rules file must not drift apart.
 *
 * `sales-rules.json` is duplicated into the KPI dashboard because the two apps
 * deploy separately. `npm run check:rules` compares the two copies when both
 * repos sit on one machine; this file covers the half that is always true here
 * — that this app's constants still say what the file says.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  MIN_DEPOSIT,
  WINNING_OUTCOMES,
  REFUND_OUTCOME,
  REFUND_CARRIES_REVENUE,
  REFUND_CARRIES_CASH,
  REFUND_CARRIES_CLOSE,
  rules,
} from "../src/lib/sales-rules";
import { OUTCOMES } from "../src/lib/types";

describe("the shared rules file", () => {
  it("is the source of every money constant in the code", () => {
    expect(MIN_DEPOSIT).toBe(rules.min_deposit.value);
    expect(REFUND_OUTCOME).toBe(rules.outcomes.refund.name);
    expect(REFUND_CARRIES_REVENUE).toBe(rules.outcomes.refund.carries_revenue);
    expect(REFUND_CARRIES_CASH).toBe(rules.outcomes.refund.carries_cash);
    expect(REFUND_CARRIES_CLOSE).toBe(rules.outcomes.refund.carries_close);
  });

  it("states the deposit floor in dollars", () => {
    expect(rules.min_deposit.currency).toBe("USD");
    expect(typeof MIN_DEPOSIT).toBe("number");
    expect(MIN_DEPOSIT).toBeGreaterThan(0);
  });

  it("names outcomes the dashboard actually knows about", () => {
    // A rule about an outcome that no row can hold is a rule that never fires.
    for (const outcome of WINNING_OUTCOMES) {
      expect(OUTCOMES).toContain(outcome);
    }
    expect(OUTCOMES).toContain(REFUND_OUTCOME);
  });

  it("has no unresolved ruling left in it", () => {
    // The file carries open questions until Moayad settles them. One reaching
    // production means a number on screen is being computed against a rule
    // nobody has agreed.
    expect(JSON.stringify(rules)).not.toContain("NEEDS_A_RULING");
  });
});

/*
 * THE SCRIPTS READ THE SAME FILE, and this is the half a running check cannot
 * prove about itself.
 *
 * check-collect.mjs decides which rows the collect list would show, so it has
 * to agree with the page about what a win is, what a refund is and what a
 * deposit has to reach. Its first version read the outcome column alone and
 * reported a different population from the panel it checks — 6 unpriced deals
 * against the panel's 9, the difference being rows the money settled. Neither
 * number was wrong; they were about different sets, which is exactly the fault
 * sales-rules.json exists to prevent, in a new place.
 */
describe("the check scripts read the rules file too", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("check-collect takes its outcomes and its floor from the file", () => {
    const src = read("scripts/check-collect.mjs");
    expect(src).toContain("sales-rules.json");
    expect(src).toContain("rules.outcomes.winning");
    expect(src).toContain("rules.outcomes.refund.name");
    expect(src).toContain("rules.min_deposit.value");
  });

  it("and does not spell out its own", () => {
    // Comments are stripped first: an explanation of the banned literal is not
    // a use of it, and this file's own headers name every outcome there is.
    const src = read("scripts/check-collect.mjs")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const outcome of ["Customer", "BAMFAM", "No deal"]) {
      expect(src, `check-collect.mjs spells out "${outcome}"`).not.toContain(`"${outcome}"`);
    }
  });
});
