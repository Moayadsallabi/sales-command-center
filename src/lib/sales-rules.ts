/**
 * The shared money and call rules, read from sales-rules.json.
 *
 * That file is the SAME FILE in the KPI dashboard's repository. It is
 * duplicated rather than imported because the two apps deploy independently and
 * cannot reach each other at runtime — see the _README inside it, and
 * `npm run check:rules`, which fails when the two copies drift apart.
 *
 * Nothing here should re-state a rule. If a number matters to both dashboards
 * it belongs in the JSON; if it only matters here, it belongs in the module
 * that uses it.
 */
import rules from "../../sales-rules.json";

/** What a payment has to reach before it proves a sale on its own. */
export const MIN_DEPOSIT: number = rules.min_deposit.value;

/** Outcomes that count as a win. */
export const WINNING_OUTCOMES: readonly string[] = rules.outcomes.winning;

/** The outcome whose money went back. */
export const REFUND_OUTCOME: string = rules.outcomes.refund.name;
export const REFUND_CARRIES_REVENUE: boolean = rules.outcomes.refund.carries_revenue;
export const REFUND_CARRIES_CASH: boolean = rules.outcomes.refund.carries_cash;

export const RULES_VERSION: string = rules.version;
export { rules };
