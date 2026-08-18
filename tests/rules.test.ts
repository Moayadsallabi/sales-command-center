/**
 * The code and the shared rules file must not drift apart.
 *
 * `sales-rules.json` is duplicated into the KPI dashboard because the two apps
 * deploy separately. `npm run check:rules` compares the two copies when both
 * repos sit on one machine; this file covers the half that is always true here
 * — that this app's constants still say what the file says.
 */
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
