import { CallRecord } from "./types";

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

export async function queryAllCalls(): Promise<CallRecord[]> {
  // Read at call time, not module load, so a .env change takes effect on the
  // next request rather than needing a cold start.
  const apiKey = process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;

  const missing: string[] = [];
  if (!apiKey) missing.push("NOTION_API_KEY");
  if (!databaseId) missing.push("NOTION_DATABASE_ID");
  if (missing.length > 0) {
    throw new NotionError(
      { kind: "missing-config", missing },
      `Missing ${missing.join(" and ")} in .env.local. See .env.example, then run \`npm run check:notion\`.`
    );
  }

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
        call_date: extractDate(props["Call Date"]),
        outcome: extractSelect(props.Outcome),
        tier: extractSelect(props.Tier),
        price_discussed: extractNumber(props["Price Discussed"]),
        price_closed: extractNumber(props["Price Closed"]),
        payment_structure: extractSelect(props["Payment Structure"]),
        cash_collected: extractNumber(props["Cash Collected"]),
        prospect_revenue: extractRichText(props["Prospect Revenue"]),
        niche: extractRichText(props.Niche),
        location: extractRichText(props.Location),
        lead_source: normalizeSource(extractSelect(props["Lead Source"])),
        quality_score: extractNumber(props["Quality Score"]),
        duration: extractNumber(props["Duration (min)"]),
        recording_url: extractUrl(props["Recording URL"]),
        summary: extractRichText(props.Summary),
      });
    }

    hasMore = data.has_more ?? false;
    startCursor = data.next_cursor ?? undefined;
  }

  return results;
}
