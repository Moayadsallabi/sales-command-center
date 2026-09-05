/**
 * Reading recordings out of Fathom, in the one place that knows how it says no.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SHARED AND NOT COPIED
 *
 * check-dropped.mjs and check-delivery.mjs both page through every closer's
 * recordings with transcripts and summaries attached, and both had their own
 * copy of the retry policy. On 2026-09-05 both copies were wrong in the same
 * two ways, and the cost landed on the busiest closer in each — the one whose
 * backlog is the reason to run either command:
 *
 *   1. They RETRIED but never PACED. Fathom serves ten meetings a page, so a
 *      busy closer is nine or ten heavy pages; asking for them back-to-back is
 *      throttled every time, and retrying only loses the race against the next
 *      page. The quiet closer read first time, the busy one failed on two
 *      consecutive runs, and the report said so and printed nothing.
 *
 *   2. A throttled Fathom can answer 200 WITH AN EMPTY BODY, which JSON.parse
 *      reports as a syntax error rather than as "slow down".
 *
 * Nothing here interprets. It fetches and pages, and that is all — whether a
 * recording is a sales call is sales-call-filter.mjs's question, and whether it
 * reached the tracker is the caller's.
 */

/** Gap between pages. Costs about a minute on a weekly command. */
export const PAGE_PACING_MS = 6000;
/** Attempts per page once Fathom has said no. Six spans about three minutes. */
export const RETRIES = 6;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thrown when Fathom will not answer, so a caller can report rather than crash. */
export class FathomReadError extends Error {}

/**
 * One page, with both of the ways Fathom says "slow down" treated as one thing.
 *
 * EVERY EXIT IS EITHER A PARSED PAGE OR A THROW. That is the point of having
 * this in one function: with the two retries written as separate loops, a retry
 * that came back 429 carried a non-empty error body, which parsed happily into
 * an object with no `items` and no `next_cursor` — so the caller pushed nothing,
 * saw no cursor, stopped early, and reported a partial read as a complete one.
 * A silently short list is the single failure both callers exist to prevent.
 */
export async function fetchPage(url, key) {
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, { headers: { "X-Api-Key": key } });

    if (res.ok) {
      const body = await res.text();
      if (body.trim() !== "") return JSON.parse(body);
      // 200 with nothing in it: throttling wearing a success code.
    } else if (res.status !== 429) {
      throw new FathomReadError(
        `Fathom refused (${res.status}). A key only reaches its own owner's recordings.`
      );
    }

    if (attempt >= RETRIES) {
      throw new FathomReadError(
        `Fathom is rate-limiting and did not recover after ${RETRIES} tries. ` +
          `Nothing was read for this closer — do not read the totals as complete.`
      );
    }
    await sleep((attempt + 1) * 8000);
  }
}

/**
 * Every recording since `createdAfter`, paced so the busiest closer is readable.
 *
 * `params` are added to every request, so a caller decides what weight it needs
 * — the transcript and the summary are both part of the sales-call rule, and a
 * caller that omits one is asking a question the rule does not answer.
 *
 * DELIBERATELY UNCAPPED. check-delivery.mjs used to stop after twenty pages,
 * which on a busy closer is a truncated read that looks exactly like a closer
 * with fewer calls. A window is bounded by `createdAfter`, which is a bound the
 * caller chose and can see; a page cap is one nothing on the report mentions.
 */
export async function readAllRecordings(key, { createdAfter, params = {} }) {
  const out = [];
  let cursor = null;
  for (let page = 0; ; page += 1) {
    if (page > 0) await sleep(PAGE_PACING_MS);
    const url = new URL("https://api.fathom.ai/external/v1/meetings");
    url.searchParams.set("created_after", createdAfter);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (cursor) url.searchParams.set("cursor", cursor);

    const data = await fetchPage(url, key);
    out.push(...(data.items ?? data.data ?? []));
    cursor = data.next_cursor;
    if (!cursor) return out;
  }
}
