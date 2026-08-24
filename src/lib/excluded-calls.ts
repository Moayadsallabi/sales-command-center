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
 * THE LIST IS THE FALLBACK, NOT THE MECHANISM. The scorer now reads the
 * client's offer description and reports whether the call was actually about
 * it, into the tracker's `Offer Match` column. A row it marks "different offer"
 * is dropped here too, without anybody adding anything to a file. This list
 * stays for the cases that predate the column, and for the ones a person has to
 * rule on by hand.
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
  /**
   * The Fathom share id — the strongest key there is, because it identifies
   * the CALL rather than the row. A Notion page id identifies one row, and a
   * row can be deleted and re-created by the automation, at which point a
   * page-id entry silently stops matching the very call it was written for.
   */
  recording_share_id?: string;
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
/** The `xyz` out of `https://fathom.video/share/xyz`. */
function shareId(url: string | null | undefined): string {
  return String(url ?? "").split("/share/")[1]?.trim().toLowerCase() ?? "";
}

export function isExcluded(
  call: CallRecord,
  entries: Exclusion[]
): Exclusion | null {
  for (const entry of entries) {
    // Recording first. It survives the row being deleted and re-created, which
    // is exactly what happens when the automation is widened and re-imports a
    // call somebody had already taken out by hand.
    if (entry.recording_share_id) {
      if (shareId(call.recording_url) === entry.recording_share_id.trim().toLowerCase()) {
        return entry;
      }
      // An entry may carry both keys; fall through to the page id rather than
      // giving up, so a row whose recording link was never filled in is still
      // caught by the id it does have.
    }
    if (entry.notion_page_id) {
      if (pageId(entry.notion_page_id) === pageId(call.id)) return entry;
      continue;
    }
    if (entry.recording_share_id) continue;
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

  const kept: CallRecord[] = [];
  const excluded: ExcludedCall[] = [];
  for (const call of calls) {
    const entry = isExcluded(call, entries) ?? foreignOffer(call);
    if (entry) excluded.push({ call, entry });
    else kept.push(call);
  }
  return { kept, excluded };
}

/**
 * The scorer's own verdict, treated as an exclusion.
 *
 * Only the positive verdict counts. "unclear" is left in and null is left in —
 * a row scored before the column existed must not vanish, and a call the model
 * could not read is still this client's until somebody says otherwise. Dropping
 * a real sale is the expensive mistake here, so the burden sits entirely on the
 * one verdict that means the transcript named a different product.
 */
export const FOREIGN_OFFER = "different offer";

function foreignOffer(call: CallRecord): Exclusion | null {
  if (String(call.offer_match ?? "").trim().toLowerCase() !== FOREIGN_OFFER) {
    return null;
  }
  return {
    call_date: call.call_date ?? undefined,
    prospect_name: call.name,
    reason:
      call.offer_evidence?.trim() ||
      "The scorer read the transcript as selling a different product.",
    ruled_by: "the scorer, from the transcript",
  };
}
