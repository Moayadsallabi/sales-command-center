"use server";

import { CallDetail } from "@/lib/types";
import { queryAllCalls, dedupeByRecording } from "@/lib/notion";
import { detailFor } from "@/lib/call-detail";
import { currentViewing } from "@/lib/viewing-request";

/**
 * THE WRITTEN HALF OF ONE CALL, ASKED FOR WHEN SOMEONE OPENS IT.
 *
 * ---------------------------------------------------------------------------
 * WHY THE PROSE DOES NOT TRAVEL WITH THE PAGE
 *
 * Five fields on a call are prose — the summary, the moment, the next drill,
 * the lead read, and the scorer's offer evidence. Measured against Brey's
 * account on 2026-09-10: 245 KB across 143 calls, out of a 655 KB payload, and
 * **59% of it once gzipped**. The dashboard re-renders itself every sixty
 * seconds and on every tab focus, so every one of those bytes went down the
 * wire again each minute, for calls nobody had opened.
 *
 * Everything else on a call is read in BULK — the averages, the leaderboard,
 * every panel counts across all of them — so it travels with the page as it
 * always did. The prose is read ONE CALL AT A TIME, by someone who clicked.
 *
 * ---------------------------------------------------------------------------
 * IT IS A POST ENDPOINT, WHATEVER IT LOOKS LIKE
 *
 * Next's own guidance is blunt about this: a server action is reachable by a
 * direct POST whether or not any component calls it, so authentication and
 * authorisation belong INSIDE it. Two layers apply here and both matter:
 *
 *   1. `proxy.ts` already refuses any request that is not signed in, and its
 *      matcher covers everything but static assets — so this inherits it.
 *   2. WHOSE calls, which the login alone does not answer. This deployment
 *      serves several clients, and a call id is guessable in a way a client
 *      list is not. So it resolves the viewing client exactly as the page
 *      does, from the same cookies, and reads through THAT client's
 *      credentials. A call id belonging to somebody else is simply not in the
 *      list this returns from, so it comes back null rather than refused —
 *      there is no answer here that says "that id exists, but not for you".
 *
 * Excluded calls are dropped the same way the page drops them, so a row that
 * belongs to another offer cannot be read through this door either.
 *
 * ---------------------------------------------------------------------------
 * IT IS NOT A SECOND READ
 *
 * `queryAllCalls` is the cached read the page itself uses (see live-cache.ts),
 * so opening a call costs a lookup in memory rather than a crawl of Notion.
 */
export async function loadCallDetail(callId: string): Promise<CallDetail | null> {
  const viewing = await currentViewing();
  if (!viewing.config) return null;

  const calls = await queryAllCalls(viewing.config.notion);
  return detailFor(dedupeByRecording(calls).kept, callId);
}
