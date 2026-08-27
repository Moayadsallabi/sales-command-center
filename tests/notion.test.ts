/**
 * Reading the tracker out of Notion.
 *
 * The rule this module must never break: it must return EVERY row, and a
 * column it could not read must come back empty rather than zero.
 *
 * Both failures are silent. Notion hands back 100 rows at a time, so a broken
 * cursor does not error — it returns a smaller, entirely plausible business,
 * and every figure downstream is quietly computed over the wrong population.
 * A missing score read as 0 instead of null does the same thing to averages:
 * it drags them down while looking like data. Neither is visible on the page,
 * neither is visible in Notion, and everything the dashboard says is computed
 * downstream of here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { queryAllCalls, NotionError } from "../src/lib/notion";
import { resetCache } from "../src/lib/live-cache";
import { DIMENSIONS } from "../src/lib/dimensions";
import { LEAD_FACTORS, NO_OBJECTION, OBJECTIONS_COLUMN } from "../src/lib/lead-quality";

const CFG = { apiKey: "secret_test", databaseId: "db-1" };

/** A Notion page with only the properties a test cares about. */
function page(id: string, properties: Record<string, unknown> = {}) {
  return { id, properties };
}

/** One query response. */
function res(results: unknown[], next: string | null = null) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ results, has_more: next != null, next_cursor: next }),
  };
}

function failure(status: number, detail = "nope") {
  return { ok: false, status, text: async () => detail };
}

let calls: { url: string; body: Record<string, unknown> }[] = [];

/** Answers the crawl with a queue of responses, recording what was asked. */
function respondWith(queue: unknown[]) {
  const remaining = [...queue];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      const next = remaining.shift();
      if (!next) throw new Error("crawl asked for more pages than the test queued");
      return next;
    })
  );
}

beforeEach(() => {
  resetCache();
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("every row, not just the first page", () => {
  it("follows the cursor to the end and returns all of them", async () => {
    respondWith([
      res([page("a"), page("b")], "cursor-2"),
      res([page("c")], "cursor-3"),
      res([page("d"), page("e")]),
    ]);

    const rows = await queryAllCalls(CFG);

    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(calls).toHaveLength(3);
  });

  it("sends no cursor first, then the one it was handed", async () => {
    respondWith([res([page("a")], "cursor-2"), res([page("b")])]);

    await queryAllCalls(CFG);

    expect(calls[0].body.start_cursor).toBeUndefined();
    expect(calls[1].body.start_cursor).toBe("cursor-2");
  });

  it("stops when Notion says there is no more, even with a cursor present", async () => {
    // has_more false and a stale next_cursor together: the cursor must not be
    // what decides, or the crawl never ends.
    respondWith([
      {
        ok: true,
        status: 200,
        json: async () => ({ results: [page("a")], has_more: false, next_cursor: "ignored" }),
      },
    ]);

    expect(await queryAllCalls(CFG)).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe("a column that was never filled in is empty, not zero", () => {
  it("leaves every dimension null on a call scored before the scorecard existed", async () => {
    respondWith([res([page("a")])]);

    const [row] = await queryAllCalls(CFG);

    for (const d of DIMENSIONS) expect(row.scores[d.key]).toBeNull();
    for (const f of LEAD_FACTORS) expect(row.lead[f.key]).toBeNull();
    expect(Object.values(row.scores)).not.toContain(0);
  });

  it("keeps a real zero as zero", async () => {
    respondWith([res([page("a", { [DIMENSIONS[0].column]: { number: 0 } })])]);

    const [row] = await queryAllCalls(CFG);

    expect(row.scores[DIMENSIONS[0].key]).toBe(0);
  });
});

describe("fields that are read rather than copied", () => {
  it("lower-cases and trims the email it joins on, and blanks to null", async () => {
    respondWith([
      res([
        page("a", { "Prospect Email": { email: "  Sam.Jones@Example.COM " } }),
        page("b", { "Prospect Email": { email: "   " } }),
        page("c"),
      ]),
    ]);

    const rows = await queryAllCalls(CFG);

    expect(rows[0].prospect_email).toBe("sam.jones@example.com");
    expect(rows[1].prospect_email).toBeNull();
    expect(rows[2].prospect_email).toBeNull();
  });

  it("files ManyChat under IG and leaves every other source alone", async () => {
    respondWith([
      res([
        page("a", { "Lead Source": { select: { name: "ManyChat" } } }),
        page("b", { "Lead Source": { select: { name: "YouTube" } } }),
      ]),
    ]);

    const rows = await queryAllCalls(CFG);

    expect(rows[0].lead_source).toBe("IG");
    expect(rows[1].lead_source).toBe("YouTube");
  });

  it("drops the scorer's 'none raised' marker instead of counting it", async () => {
    // Counting it would put "None raised" top of every objection chart.
    respondWith([
      res([
        page("a", {
          [OBJECTIONS_COLUMN]: { multi_select: [{ name: NO_OBJECTION }] },
        }),
        page("b", {
          [OBJECTIONS_COLUMN]: {
            multi_select: [{ name: "Price" }, { name: NO_OBJECTION }, { name: "" }],
          },
        }),
      ]),
    ]);

    const rows = await queryAllCalls(CFG);

    expect(rows[0].objections).toEqual([]);
    expect(rows[1].objections).toEqual(["Price"]);
  });

  it("joins rich text that Notion split across runs", async () => {
    // Notion splits a string at every formatting change, so reading only the
    // first run truncates a sentence at its first bold word.
    respondWith([
      res([
        page("a", {
          Name: { title: [{ plain_text: "Sam " }, { plain_text: "Jones" }] },
          Summary: { rich_text: [{ plain_text: "Went " }, { plain_text: "well" }] },
        }),
      ]),
    ]);

    const [row] = await queryAllCalls(CFG);

    expect(row.name).toBe("Sam Jones");
    expect(row.summary).toBe("Went well");
  });

  it("builds a Notion link the browser accepts", async () => {
    respondWith([res([page("1a2b3c-4d5e-6f70")])]);

    const [row] = await queryAllCalls(CFG);

    expect(row.notion_url).toBe("https://www.notion.so/1a2b3c4d5e6f70");
  });
});

describe("failures say which one it was", () => {
  const cases: [number, string][] = [
    [401, "unauthorized"],
    [404, "not-found"],
    [400, "not-found"],
  ];

  for (const [status, kind] of cases) {
    it(`maps ${status} to ${kind}`, async () => {
      respondWith([failure(status)]);
      await expect(queryAllCalls(CFG)).rejects.toMatchObject({
        failure: { kind },
      });
    });
  }

  it("keeps the status on anything else", async () => {
    respondWith([failure(503, "upstream down")]);
    await expect(queryAllCalls(CFG)).rejects.toMatchObject({
      failure: { kind: "api", status: 503, detail: "upstream down" },
    });
  });

  it("names both missing settings, and says so on every render", async () => {
    respondWith([]);

    for (let i = 0; i < 3; i++) {
      const err = await queryAllCalls({ apiKey: null, databaseId: null }).catch((e) => e);
      // Not cached: a deployment with no credentials must say so every time,
      // not once depending on which request arrived first.
      expect(err).toBeInstanceOf(NotionError);
      expect(err.failure).toEqual({
        kind: "missing-config",
        missing: ["NOTION_API_KEY", "NOTION_DATABASE_ID"],
      });
    }
  });

  it("does not cache a failed first read", async () => {
    respondWith([failure(500), res([page("a")])]);

    await expect(queryAllCalls(CFG)).rejects.toBeInstanceOf(NotionError);
    // The retry must reach Notion rather than being served a cached error.
    expect(await queryAllCalls(CFG)).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });
});

describe("one token, two clients", () => {
  it("never serves one database's calls under another's", async () => {
    // One integration token can be granted several clients' trackers. Keying
    // the cache on the token alone would render the first client's calls on
    // the second client's dashboard — which is not an error anyone would see.
    respondWith([res([page("client-one-call")]), res([page("client-two-call")])]);

    const first = await queryAllCalls({ apiKey: "shared", databaseId: "db-A" });
    const second = await queryAllCalls({ apiKey: "shared", databaseId: "db-B" });

    expect(first[0].id).toBe("client-one-call");
    expect(second[0].id).toBe("client-two-call");
    expect(calls).toHaveLength(2);
  });

  it("does answer the same database from memory", async () => {
    respondWith([res([page("a")])]);

    await queryAllCalls(CFG);
    await queryAllCalls(CFG);

    expect(calls).toHaveLength(1);
  });
});
