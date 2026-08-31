/**
 * TYING A TRACKER ROW TO A BUYER IN THE PAYMENT PROCESSOR. ONE COPY OF IT.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * This ran as two implementations — one in `src/lib/reconcile.ts` for the page,
 * one in `scripts/check-payments.mjs` for the report — and reconcile.ts carried
 * a comment saying the two were "deliberately the same as the script's,
 * including its refusals". Every RULE was the same: token lengths, the tie
 * refusal, best-first assignment, one buyer per call. They still gave different
 * answers on Brey's live August, in both directions, because the script had
 * been fixed twice and the library had not:
 *
 *   1. the script reads each payment's BILLING NAME into the text it matches
 *      against; the library's Whop reader never fetched the field, so it was
 *      matching handles like "kokitosh" and "liamb48" against real names
 *   2. the script requires a score of two before it accepts a name match; the
 *      library accepted one, so "Robert Brown" took Robert Kane's $540 and
 *      "Jaden Pierce" took Jaden Swanson's $2,000, and both were counted as
 *      closes on the dashboard
 *
 * Neither could be seen in review: a shared algorithm fed different inputs
 * reads exactly like a shared implementation. Neither could be seen by the
 * tests either, because each side's fixtures were built by the same person who
 * wrote that side.
 *
 * So the rule is now written once, here, and both sides import it. This is the
 * same shape `sales-call-filter.mjs` already uses for the title rule, and for
 * the same reason: a second copy agrees until the day it does not.
 *
 * Plain .mjs rather than TypeScript because a .mjs script cannot import a .ts
 * module, and the script is the side that can write corrections into Notion.
 */

/** A fallback match needs a token at least this long — short names collide. */
export const MIN_NAME_TOKEN = 3;
/** Below this a token only counts as a whole word, never buried in another. */
export const MIN_SUBSTRING_TOKEN = 5;
/**
 * TWO SIGNALS, NEVER ONE.
 *
 * A single shared word off a two-word name is not a weak match, it is a
 * different person. "Barron ace" scored a hit on "Ace Acosta" and reported his
 * $4,000 against Barron's call; "Jon gonzalez" took Robinson Gonzalez's $562;
 * "Robert Brown" took Robert Kane's $540. Every one of them was the only
 * candidate, so the tie rule below could not catch them either — a lone wrong
 * answer looks exactly like a confident right one.
 *
 * A ONE-WORD ROW NAME IS UNAFFECTED, which is the part worth not breaking:
 * the whole name is then the single token, so a genuine hit scores its token
 * plus the whole-name bonus and reaches two on its own. That is what keeps
 * "Liam" finding Liam Beauchamps and "Tyre" finding Tyre Tribble.
 */
export const MIN_SCORE = 2;
/** Below this, a difference is fees or rounding rather than a mistake. */
export const CASH_TOLERANCE = 50;

export const normalise = (s) =>
  (s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * The text one buyer is matched against.
 *
 * THE BILLING NAME COMES FIRST BECAUSE IT IS THE ONLY REAL ONE. `name` is the
 * processor's display name and is usually a handle — "stonyartisan82",
 * "kokitosh", "jackdadawg" — which matches nothing on a call row. The billing
 * name is the person ("Luke Mcdougall", "George Segovia", "Liam Beauchamps")
 * and is present on every payment. Matching on the handle alone is why rows
 * carrying a perfectly good name came back unmatched.
 */
export function buyerText(buyer) {
  return normalise(
    `${buyer.billing ?? ""} ${buyer.name ?? ""} ${String(buyer.email ?? "").split("@")[0]}`
  );
}

/** Every buyer paired with the text they are matched against. */
export function buyerHaystacks(buyers) {
  return [...buyers].map((buyer) => ({ buyer, text: buyerText(buyer) }));
}

/**
 * A short name only counts as a whole word. Without that rule "Tee" matches
 * "steel" and the fallback starts inventing customers; with it, "Tee" still
 * finds "Tee Dory". Longer tokens are allowed to sit inside a word, because
 * that is how usernames are built — "beshensky" inside "bbeshensky".
 */
function tokenHits(tokens, text) {
  const padded = ` ${text} `;
  return tokens.filter(
    (t) => padded.includes(` ${t} `) || (t.length >= MIN_SUBSTRING_TOKEN && text.includes(t))
  ).length;
}

/**
 * How well a row's name fits one buyer's text.
 *
 * Its own function because the duplicate-close guard in check-payments has to
 * ask exactly the same question of rows this matcher has already turned away,
 * and two copies of a matching rule drift.
 */
export function nameScore(name, text) {
  const full = normalise(name);
  const tokens = full.split(/\s+/).filter((t) => t.length >= MIN_NAME_TOKEN);
  if (tokens.length === 0 || !text) return 0;
  const hits = tokenHits(tokens, text);
  // A buyer carrying the whole name outranks one sharing a single word.
  return hits === 0 ? 0 : hits + (text.includes(full) ? 1 : 0);
}

/**
 * Email is the only join anyone should trust, and most rows do not have one —
 * a prospect who was never a guest on the calendar invite leaves the column
 * blank. So there is a fallback on name, and everything it produces is
 * reported as a guess rather than a finding. A wrong guess here would send
 * someone to edit the wrong prospect's row, which is worse than a gap.
 */
function scoreCandidates(item, { emailOf, nameOf }, byEmail, haystacks) {
  const email = emailOf(item);
  const direct = email ? byEmail.get(email) : undefined;
  if (direct) return [{ buyer: direct, score: Infinity, certain: true }];

  return haystacks
    .map(({ buyer, text }) => ({ buyer, score: nameScore(nameOf(item), text), certain: false }))
    .filter((c) => c.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);
}

/**
 * Best-first assignment of buyers to rows, skipping any row whose two best
 * candidates tie.
 *
 * Every candidate pair is scored before any of them is accepted, because
 * matching row by row lets whichever row happens to come first take a payment
 * that belongs to a better match further down: a row reading "Daniel" claims
 * Jeremy Daniel's payment, and the real Jeremy Daniel row is then reported as
 * a customer who never paid. Scoring first and assigning best-first means the
 * two-token match wins and the one-token match is left unmatched, which is the
 * honest answer.
 *
 * `items` are whatever the caller calls a row — a CallRecord on the page, a
 * tracker row in the script — and are keyed by identity in the returned map,
 * so the caller gets its own objects back rather than a copy to re-join.
 */
export function matchBuyers(items, buyers, { emailOf, nameOf }) {
  const list = [...buyers];
  const byEmail = new Map(list.map((b) => [b.email, b]));
  const haystacks = buyerHaystacks(list);

  const pairs = [];
  for (const item of items) {
    const ranked = scoreCandidates(item, { emailOf, nameOf }, byEmail, haystacks);
    if (ranked.length === 0) continue;
    // A tie means two different people fit equally well and nothing here can
    // tell them apart. Reporting a gap beats sending someone to the wrong row.
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) continue;
    pairs.push({ item, ...ranked[0] });
  }

  pairs.sort((a, b) => b.score - a.score);

  const byItem = new Map();
  const taken = new Set();
  for (const pair of pairs) {
    if (byItem.has(pair.item) || taken.has(pair.buyer.email)) continue;
    byItem.set(pair.item, { buyer: pair.buyer, score: pair.score, certain: pair.certain });
    taken.add(pair.buyer.email);
  }
  return byItem;
}
