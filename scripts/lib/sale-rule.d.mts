/** Types for `sale-rule.mjs`. See that file for the rule and its two readers. */

/** The thresholds each side reads out of sales-rules.json for itself. */
export interface SaleRules {
  winning: readonly string[];
  refund: string;
  minDeposit: number;
}

/** The greater of the tracker's figure and the processor's. Never the sum. */
export function moneyMoved(
  tracked: number | null | undefined,
  matched: number | null | undefined
): number;

/** Whether a call counts as a close: a winning outcome AND money that moved. */
export function countsAsWin(
  outcome: string | null | undefined,
  moved: number,
  rules: SaleRules
): boolean;
