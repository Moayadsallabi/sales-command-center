/**
 * Calls that sit on this client's tracker but are not this client's business.
 *
 * The list itself, and why it is a hand-written list rather than a rule, is in
 * `excluded-calls.json` at the repo root. Read that before adding to it. The
 * short version: a closer who sells two offers books both into one tracker,
 * because the tracker follows the closer's calendar and not the product, and
 * no column on the row says which offer was sold.
 *
 * WHERE IT IS APPLIED. On the raw Notion read, before bookings, reconciliation
 * or settlement see the calls — so an excluded row cannot be matched to a
 * booking, cannot be turned into a win by a payment, and cannot reach revenue,
 * the close rate, the leaderboard or any score average. Filtering later would
 * leave each of those to remember the rule separately.
 *
 * FAILS OPEN, DELIBERATELY, the same way the KPI dashboard's copy does. A
 * missing or malformed file excludes nothing and says so in the server log.
 * The opposite choice — refusing to render — would take the whole dashboard
 * down over an optional file, and the fault it guards against (a few thousand
 * dollars counted that should not be) is smaller than the one it would cause.
 *
 * EVERY CLIENT KEY IN THE FILE IS READ, not just one. This deployment already
 * points at exactly one client's tracker, so there is no client name to select
 * on that could be typed wrong — and a mistyped name would exclude nothing at
 * all, silently, which is the failure that matters here. The page id is the
 * row's own identifier, so a foreign entry cannot match by accident.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CallRecord } from "./types";

export interface Exclusion {
  call_date?: string;
  prospect_name?: string;
  notion_page_id?: string;
  price_closed?: number;
  reason?: string;
  ruled_by?: string;
}

/** An excluded call, paired with the entry that ruled it out. */
export interface ExcludedCall {
  call: CallRecord;
  entry: Exclusion;
}

const FILE = join(process.cwd(), "excluded-calls.json");

const norm = (value: string | null | undefined): string =>
  String(value ?? "").trim().toLowerCase();

/** A Notion page id compares the same whether or not it carries its dashes. */
const pageId = (value: string | null | undefined): string =>
  norm(value).replace(/-/g, "");

const day = (value: string | null | undefined): string =>
  String(value ?? "").slice(0, 10);

/** Every entry in the file, across every client key it holds. */
export function loadExclusions(file: string = FILE): Exclusion[] {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    // ENOENT is the normal state for a deployment that has never needed one.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("ENOENT")) {
      console.warn(`[excluded-calls] ignoring excluded-calls.json — ${message}`);
    }
    return [];
  }

  const entries: Exclusion[] = [];
  for (const [key, list] of Object.entries(parsed)) {
    if (key.startsWith("_")) continue;
    if (Array.isArray(list)) entries.push(...(list as Exclusion[]));
  }
  return entries;
}

/**
 * Is this call one of them?
 *
 * The page id wins whenever the entry carries one: it is the tracker row's own
 * identifier, so it holds even when the row is named "Unknown" and even if
 * somebody renames it. Date plus name is the fallback for older entries, and
 * both must match — a first name like "Liam" on its own would sweep up every
 * other Liam who ever books.
 */
export function isExcluded(
  call: CallRecord,
  entries: Exclusion[]
): Exclusion | null {
  for (const entry of entries) {
    if (entry.notion_page_id) {
      if (pageId(entry.notion_page_id) === pageId(call.id)) return entry;
      continue;
    }
    const date = day(call.call_date);
    const name = norm(call.name);
    if (!date || !name) continue;
    if (day(entry.call_date) === date && norm(entry.prospect_name) === name) {
      return entry;
    }
  }
  return null;
}

/**
 * Split the tracker's calls into the ones to count and the ones to leave out.
 *
 * Both halves are returned rather than just the survivors, so the caller can
 * SAY what it dropped. A silent filter is how a stale list stops being noticed
 * — and this list only ever holds what somebody remembered to add to it.
 */
export function partitionCalls(
  calls: CallRecord[],
  file: string = FILE
): { kept: CallRecord[]; excluded: ExcludedCall[] } {
  const entries = loadExclusions(file);
  if (entries.length === 0) return { kept: calls, excluded: [] };

  const kept: CallRecord[] = [];
  const excluded: ExcludedCall[] = [];
  for (const call of calls) {
    const entry = isExcluded(call, entries);
    if (entry) excluded.push({ call, entry });
    else kept.push(call);
  }
  return { kept, excluded };
}
