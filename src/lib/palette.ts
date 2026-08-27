/**
 * The colours this app writes into inline styles, as hex strings.
 *
 * ---------------------------------------------------------------------------
 * WHY A SECOND PLACE, WHEN globals.css ALREADY HAS TOKENS
 *
 * These values are string-concatenated with an alpha suffix in several places
 * (`${OUTCOME_COLORS[o]}1a`), so they cannot be `var(--color-negative)` — a CSS
 * variable is not a hex string and `var(--x)1a` is nothing. So the same colours
 * exist twice: once as tokens for the stylesheet, once here for JavaScript.
 *
 * That duplication is exactly how #ef4444 survived. The saturated red was
 * removed from the palette on the reasoning that a saturated green and red
 * beside this gold read as a traffic light — but it was removed from the
 * TOKENS, and it lived on as a literal in four component files. On 2026-08-27
 * a cross-repo token check reported "tokens agree" while fifteen elements on
 * the screen still rendered the removed colour.
 *
 * So the values here are asserted against design-tokens.json by
 * `npm run check:tokens`, and that check also fails when a banished literal
 * appears anywhere in the source. Import from here; never type a hex.
 */

/** Good. Deliberately desaturated — see the note in globals.css. */
export const POSITIVE = "#6ee7a8";

/** Bad, and the only red. Replaces #ef4444 everywhere. */
export const NEGATIVE = "#f4776b";

/** The brand. Carries no verdict — it marks what is ours, never what is good. */
export const GOLD = "#d4af37";

/** Reserved for one thing: how far the page can be trusted. */
export const AMBER = "#f59e0b";

/** No verdict at all: a category, a missing value, a series with no meaning. */
export const NEUTRAL = "#6b7280";

/**
 * Distinct from NEGATIVE on purpose: a refund is not a lost deal, and the two
 * sit next to each other in the same legend.
 */
export const CRIMSON = "#e11d48";
