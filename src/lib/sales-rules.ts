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
/**
 * Whether a refunded deal still counts in the close rate.
 *
 * [STATED - Moayad, 2026-08-18] "should be removed from revenue and cash
 * collected, should also be removed from close rate." Out of BOTH sides of it:
 * the closer did close them and the customer later left, so scoring it as a
 * failed call makes a different claim from the one the refund actually makes.
 */
export const REFUND_CARRIES_CLOSE: boolean = rules.outcomes.refund.carries_close;

export const RULES_VERSION: string = rules.version;
export { rules };
