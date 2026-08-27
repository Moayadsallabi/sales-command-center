import { CallRecord } from "./types";
import { DIMENSIONS, DimensionKey } from "./dimensions";
import {
  LEAD_FACTORS,
  LeadFactorKey,
  NO_OBJECTION,
  OBJECTIONS_COLUMN,
  PRIMARY_OBJECTION_COLUMN,
  LEAD_READ_COLUMN,
} from "./lead-quality";
import { accountKey, cachedRead, cacheSecondsFrom } from "./live-cache";

/**
 * How long a set of calls is served before a re-read is started behind the
 * reader, and how long it may go on being served if those re-reads keep
 * failing. Sixty seconds is not a new claim about freshness — it is the
 * interval the dashboard already refreshes itself on, so this changes nothing
 * about how current the numbers are. It only stops the reader waiting for the
 * crawl. See live-cache.ts.
 */
const DEFAULT_CACHE_SECONDS = 60;
const MAX_STALE_MS = 10 * 60_000;

/** Why a Notion read failed, in terms the setup screen can explain. */
export type NotionFailure =
  | { kind: "missing-config"; missing: string[] }
  | { kind: "unauthorized" }
  | { kind: "not-found" }
  | { kind: "api"; status: number; detail: string };

export class NotionError extends Error {
  readonly failure: NotionFailure;

  constructor(failure: NotionFailure, message: string) {
    super(message);
    this.name = "NotionError";
    this.failure = failure;
  }
}

type RichTextItem = { plain_text?: string };

type NotionProperty = {
  title?: RichTextItem[];
  rich_text?: RichTextItem[];
  date?: { start?: string | null } | null;
  select?: { name?: string } | null;
  number?: number | null;
  url?: string | null;
  email?: string | null;
  checkbox?: boolean;
  multi_select?: { name?: string }[] | null;
};

type NotionPage = {
  id: string;
  properties: Record<string, NotionProperty | undefined>;
};

type QueryResponse = {
  results?: NotionPage[];
  has_more?: boolean;
  next_cursor?: string | null;
};

function extractTitle(prop?: NotionProperty): string {
  if (!prop?.title) return "";
  return prop.title.map((t) => t.plain_text ?? "").join("");
}

function extractDate(prop?: NotionProperty): string | null {
  return prop?.date?.start ?? null;
}

function extractSelect(prop?: NotionProperty): string | null {
  return prop?.select?.name ?? null;
}

function extractNumber(prop?: NotionProperty): number | null {
  if (prop?.number == null) return null;
  return prop.number;
}

function extractRichText(prop?: NotionProperty): string {
  if (!prop?.rich_text) return "";
  return prop.rich_text.map((t) => t.plain_text ?? "").join("");
}

function normalizeSource(source: string | null): string | null {
  if (source === "ManyChat") return "IG";
  return source;
}

function extractUrl(prop?: NotionProperty): string | null {
  return prop?.url ?? null;
}

/**
 * Lower-cased on the way in, because it is a join key and nothing downstream
 * should have to remember how the address was typed on the calendar invite.
 */
function extractEmail(prop?: NotionProperty): string | null {
  const value = (prop?.email ?? "").trim().toLowerCase();
  return value === "" ? null : value;
}

function extractCheckbox(prop?: NotionProperty): boolean {
  return prop?.checkbox ?? false;
}

/**
 * "None raised" is how the scorer says no objection came up, and it is stored
 * so a Notion view can tell it apart from a call nobody has scored yet. The
 * dashboard wants the empty list instead — counting "None raised" as an
 * objection would put it top of every frequency chart.
 */
function extractObjections(prop?: NotionProperty): string[] {
  if (!prop?.multi_select) return [];
  return prop.multi_select
    .map((o) => o.name ?? "")
    .filter((name) => name !== "" && name !== NO_OBJECTION);
}

/** A Notion page id is a dashed UUID; the web URL wants it without dashes. */
function pageUrl(id: string): string {
  return `https://www.notion.so/${id.replace(/-/g, "")}`;
}

/**
 * Reads the eight scorecard columns. A call recorded before the scorecard
 * shipped has none of them, which reads as all-null rather than zeros — the
 * dashboard then leaves that call out of score averages instead of dragging
 * them down.
 */
function extractScores(
  props: Record<string, NotionProperty | undefined>
): Record<DimensionKey, number | null> {
  const scores = {} as Record<DimensionKey, number | null>;
  for (const dimension of DIMENSIONS) {
    scores[dimension.key] = extractNumber(props[dimension.column]);
  }
  return scores;
}

/**
 * The lead-quality half. Reads the same way as the dimensions: a factor the
 * call never produced evidence for is empty rather than zero, so it drops out
 * of the total instead of dragging it down.
 */
function extractLead(
  props: Record<string, NotionProperty | undefined>
): Record<LeadFactorKey, number | null> {
  const lead = {} as Record<LeadFactorKey, number | null>;
  for (const factor of LEAD_FACTORS) {
    lead[factor.key] = extractNumber(props[factor.column]);
  }
  return lead;
}

/**
 * Optional, and defaulting to the environment on purpose. Passing a config is
 * what lets one deployment serve several clients; passing nothing is exactly
 * today's behaviour, which is what keeps the existing deployments working
 * while the two paths overlap.
 */
export async function queryAllCalls(cfg?: { apiKey: string | null; databaseId: string | null }): Promise<CallRecord[]> {
  // Read at call time, not module load, so a .env change takes effect on the
  // next request rather than needing a cold start.
  const apiKey = cfg ? cfg.apiKey : process.env.NOTION_API_KEY;
  const databaseId = cfg ? cfg.databaseId : process.env.NOTION_DATABASE_ID;

  // OUTSIDE THE CACHE ON PURPOSE. A deployment with no credentials must say so
  // on every render, not once — otherwise the setup notice would depend on
  // which request happened to arrive first.
  const missing: string[] = [];
  if (!apiKey) missing.push("NOTION_API_KEY");
  if (!databaseId) missing.push("NOTION_DATABASE_ID");
  if (missing.length > 0) {
    throw new NotionError(
      { kind: "missing-config", missing },
      `Missing ${missing.join(" and ")} in .env.local. See .env.example, then run \`npm run check:notion\`.`
    );
  }

  return cachedRead(
    // The DATABASE as well as the key: one integration token can be granted
    // several clients' trackers, and keying on the token alone would serve the
    // first one's calls to all of them.
    accountKey("notion", apiKey, databaseId),
    () => crawlAllCalls(apiKey as string, databaseId as string),
    {
      ttlMs: cacheSecondsFrom("NOTION_CACHE_SECONDS", DEFAULT_CACHE_SECONDS) * 1000,
      maxStaleMs: MAX_STALE_MS,
    }
  );
}

/** Every page of the tracker, read fresh. Callers go through queryAllCalls. */
async function crawlAllCalls(apiKey: string, databaseId: string): Promise<CallRecord[]> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };

  const results: CallRecord[] = [];
  let hasMore = true;
  let startCursor: string | undefined;

  while (hasMore) {
    const body: { page_size: number; start_cursor?: string } = {
      page_size: 100,
    };
    if (startCursor) body.start_cursor = startCursor;

    const resp = await fetch(
      `https://api.notion.com/v1/databases/${databaseId}/query`,
      { method: "POST", headers, body: JSON.stringify(body), cache: "no-store" }
    );

    if (!resp.ok) {
      const detail = await resp.text();
      if (resp.status === 401) {
        throw new NotionError({ kind: "unauthorized" }, detail);
      }
      // Notion answers both "no such database" and "the integration cannot see
      // it" with 404, and a malformed id with 400.
      if (resp.status === 404 || resp.status === 400) {
        throw new NotionError({ kind: "not-found" }, detail);
      }
      throw new NotionError({ kind: "api", status: resp.status, detail }, detail);
    }

    const data: QueryResponse = await resp.json();

    for (const page of data.results ?? []) {
      const props = page.properties;
      results.push({
        id: page.id,
        name: extractTitle(props.Name),
        prospect_email: extractEmail(props["Prospect Email"]),
        closer: extractSelect(props.Closer),
        call_date: extractDate(props["Call Date"]),
        outcome: extractSelect(props.Outcome),
        price_discussed: extractNumber(props["Price Discussed"]),
        price_closed: extractNumber(props["Price Closed"]),
        payment_structure: extractSelect(props["Payment Structure"]),
        collected_on_call: extractNumber(props["Collected On Call"]),
        cash_collected: extractNumber(props["Cash Collected"]),
        outstanding: extractNumber(props.Outstanding),
        currency: extractSelect(props.Currency),
        fx_rate: extractNumber(props["FX Rate"]),
        prospect_revenue: extractRichText(props["Prospect Revenue"]),
        niche: extractRichText(props.Niche),
        location: extractRichText(props.Location),
        lead_source: normalizeSource(extractSelect(props["Lead Source"])),
        quality_score: extractNumber(props["Quality Score"]),
        duration: extractNumber(props["Duration (min)"]),
        recording_url: extractUrl(props["Recording URL"]),
        summary: extractRichText(props.Summary),
        scores: extractScores(props),
        lead: extractLead(props),
        lead_read: extractRichText(props[LEAD_READ_COLUMN]),
        objections: extractObjections(props[OBJECTIONS_COLUMN]),
        primary_objection: extractSelect(props[PRIMARY_OBJECTION_COLUMN]),
        flags: {
          value_leak: extractCheckbox(props["Value Leak"]),
          follow_up_trap: extractCheckbox(props["Follow-Up Trap"]),
          early_price_drop: extractCheckbox(props["Early Price Drop"]),
          weakest_belief: extractSelect(props["Weakest Belief"]),
        },
        the_moment: extractRichText(props["The Moment"]),
        next_call_drill: extractRichText(props["Next Call Drill"]),
        offer_match: extractSelect(props["Offer Match"]),
        offer_evidence: extractRichText(props["Offer Evidence"]),
        notion_url: pageUrl(page.id),
      });
    }

    hasMore = data.has_more ?? false;
    startCursor = data.next_cursor ?? undefined;
  }

  return results;
}
