/**
 * ONE RAMP FOR "HOW GOOD IS THIS SCORE", SHARED BY EVERY PANEL THAT PAINTS ONE.
 *
 * The same three-band ladder was written out five times — twice in the call
 * table, once in what-is-costing-you, twice in the scorecard, and once more as
 * Tailwind classes on the closer leaderboard. The comment in the call table
 * records what that costs: one copy started its good band at 8 while every
 * other started at 7.5, so a call scored 7.7 was one colour on the leaderboard
 * and a different colour in the table. The bands live here now, and a panel
 * that wants a colour asks for one.
 *
 * GREEN IS GOOD, AND GOLD IS NOT.
 * Gold is the brand — it says a thing is ours, never that it is good (see the
 * note in palette.ts). It was carrying the top band anyway, which left the
 * page with no colour that meant "well done" and made a strong lead at 78 sit
 * a shade away from a moderate one at 58. Green carries the verdict now, and
 * gold is free to mean money and ownership again. [STATED — Moayad,
 * 2026-08-28: "when we have a good lead or call performance lets make it green
 * since yellow isnt working well".]
 */
import { AMBER, NEGATIVE, POSITIVE } from "./palette";
import { GOOD_CALL_SCORE, POOR_SCORE } from "./stats";
import { FAIR_LEAD_SCORE, GOOD_LEAD_SCORE, LEAD_MAX } from "./lead-quality";

/** A call's 0–10 quality score as a hex colour. */
export function callScoreHex(score: number): string {
  if (score >= GOOD_CALL_SCORE) return POSITIVE;
  if (score >= POOR_SCORE) return AMBER;
  return NEGATIVE;
}

/** A lead's 0–100 score as a hex colour, on the same three bands. */
export function leadScoreHex(score: number): string {
  if (score >= GOOD_LEAD_SCORE) return POSITIVE;
  if (score >= FAIR_LEAD_SCORE) return AMBER;
  return NEGATIVE;
}

/**
 * A single lead factor, which is scored out of its own maximum rather than out
 * of 100. Scaling here rather than at each call site means no panel has to
 * remember that the bands are written on the 0–100 scale.
 */
export function leadFactorHex(score: number, max: number): string {
  return leadScoreHex((score / max) * LEAD_MAX);
}

/**
 * The call-score ramp as a Tailwind text class, for the one table that colours
 * text rather than a bar. Same thresholds as callScoreHex by construction.
 */
export function callScoreTextClass(score: number | null): string {
  if (score == null) return "text-zinc-400";
  if (score >= GOOD_CALL_SCORE) return "text-[var(--color-positive)]";
  if (score >= POOR_SCORE) return "text-amber-400";
  return "text-[var(--color-negative)]";
}
