import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { resolveViewing, servableClients, credentialsFor, forgetCredentials } from "../src/lib/client-config";

/**
 * THE RULES THAT KEEP ONE CLIENT OUT OF ANOTHER'S CALLS.
 *
 * The switcher is admin-only, and "admin" is a claim only the console can make.
 * Everything below asserts that the browser cannot promote itself: a pinned
 * client id is a REQUEST, honoured only after the console says the person
 * holding it is the Lab.
 *
 * The second thing asserted here is quieter and matters as much: when a switch
 * cannot be completed, the page must render NOTHING — config comes back null
 * and the refusal is the whole page. It used to fall back to the deployment's
 * own client with a banner, and the banner was not enough: Moayad read his own
 * tracker's numbers under Karan Thind's name in the bar on 2026-08-28. A
 * number attached to the wrong name is worse than a missing number.
 */

const ADMIN = { authenticated: true, role: "admin", client_id: null, client_name: null };
const CLIENT = { authenticated: true, role: "client", client_id: "karan", client_name: "Karan Thind" };

/** A registry row as `/api/registry/clients` sends it. */
function row(
  id: string,
  name: string,
  opts: { status?: string; internal?: boolean; notion?: boolean } = {}
) {
  return {
    id,
    name,
    status: opts.status ?? "active",
    is_internal: opts.internal ?? false,
    integrations: [{ provider: "notion", configured: opts.notion ?? true }],
  };
}

/** Credentials as `/api/internal/credentials/:id` sends them. */
function creds(id: string, name: string) {
  return {
    client: { id, name, status: "active" },
    integrations: {
      notion: { api_key: `key-${id}`, account_id: `db-${id}`, config: {} },
    },
  };
}

type Routes = {
  who?: unknown;
  clients?: unknown[];
  credentials?: Record<string, unknown>;
};

/** Answers the three console endpoints; anything else 404s, loudly. */
function mockConsole({ who, clients, credentials = {} }: Routes) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    calls.push(url);
    const ok = (body: unknown) =>
      ({ ok: true, json: async () => body }) as unknown as Response;
    const refused = (status: number) =>
      ({ ok: false, status, json: async () => ({}) }) as unknown as Response;

    if (url.includes("/api/session/whoami")) {
      return who ? ok(who) : ok({ authenticated: false });
    }
    if (url.includes("/api/registry/clients")) {
      // The console answers 403 to a client session. Mirrored here, because
      // that refusal is what makes the list admin-only.
      return clients ? ok({ clients }) : refused(403);
    }
    const m = url.match(/\/api\/internal\/credentials\/(.+)$/);
    if (m) {
      const body = credentials[decodeURIComponent(m[1])];
      return body ? ok(body) : refused(404);
    }
    return refused(404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

beforeEach(() => {
  /* CREDENTIALS ARE REMEMBERED FOR A MINUTE, and module state outlives a test.
     Without this, a case that succeeds leaves its answer behind and the next
     case's mock is never reached — which is exactly how it failed the first
     time: the test asserting that a REFUSED switch says so was quietly handed
     the previous test's success and passed nothing. */
  forgetCredentials();
  vi.stubEnv("REGISTRY_TOKEN", "internal-token");
  vi.stubEnv("IDENTITY_URL", "https://console.test");
  vi.stubEnv("CLIENT_ID", "brey");
  vi.stubEnv("NEXT_PUBLIC_BRAND_NAME", "Funded Blueprint");
  vi.stubEnv("NOTION_API_KEY", "env-key");
  vi.stubEnv("NOTION_DATABASE_ID", "env-db");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("who may switch client", () => {
  it("gives a client no roster at all, so the switcher cannot render", async () => {
    mockConsole({ who: CLIENT, credentials: { karan: creds("karan", "Karan Thind") } });

    const v = await resolveViewing("kpi_token=x", null);

    expect(v.clients).toEqual([]);
    expect(v.config?.clientId).toBe("karan");
  });

  it("IGNORES a client's pinned cookie rather than honouring it", async () => {
    // The exact attack this is arranged against: a client session that has
    // somehow acquired an admin's cookie VALUE. The id is not a permission.
    mockConsole({
      who: CLIENT,
      credentials: {
        karan: creds("karan", "Karan Thind"),
        brey: creds("brey", "Funded Blueprint"),
      },
    });

    const v = await resolveViewing("kpi_token=x", "brey");

    expect(v.chosen).toBeNull();
    expect(v.config?.clientId).toBe("karan");
    expect(v.config?.brandName).toBe("Karan Thind");
  });

  it("never asks for the pinned client's credentials on a client session", async () => {
    const calls = mockConsole({
      who: CLIENT,
      credentials: {
        karan: creds("karan", "Karan Thind"),
        brey: creds("brey", "Funded Blueprint"),
      },
    });

    await resolveViewing("kpi_token=x", "brey");

    expect(calls.some((u) => u.includes("credentials/brey"))).toBe(false);
  });

  it("offers an admin the roster, and this deployment's own client until one is picked", async () => {
    mockConsole({ who: ADMIN, clients: [row("brey", "Funded Blueprint"), row("karan", "Karan Thind")] });

    const v = await resolveViewing("kpi_token=x", null);

    expect(v.clients.map((c) => c.name)).toEqual(["Funded Blueprint", "Karan Thind"]);
    expect(v.config?.source).toBe("environment");
    expect(v.switchError).toBeNull();
  });

  it("renders the client an admin picked, under that client's name", async () => {
    mockConsole({
      who: ADMIN,
      clients: [row("brey", "Funded Blueprint"), row("karan", "Karan Thind")],
      credentials: { karan: creds("karan", "Karan Thind") },
    });

    const v = await resolveViewing("kpi_token=x", "karan");

    expect(v.chosen).toBe("karan");
    expect(v.config?.brandName).toBe("Karan Thind");
    expect(v.config?.notion.apiKey).toBe("key-karan");
    expect(v.switchError).toBeNull();
  });
});

describe("remembering a client's keys", () => {
  it("asks the console once, then answers from memory", async () => {
    const calls = mockConsole({
      who: ADMIN,
      clients: [row("karan", "Karan Thind")],
      credentials: { karan: creds("karan", "Karan Thind") },
    });
    const asked = () => calls.filter((u) => u.includes("/api/internal/credentials/")).length;

    await credentialsFor("karan");
    await credentialsFor("karan");
    await credentialsFor("karan");

    // Three renders, one question. This was 1.6 seconds of round trips per
    // render before, and it is the largest single cost the page had.
    expect(asked()).toBe(1);
  });

  it("asks for the switcher menu once per visitor, and never shares it", async () => {
    const calls = mockConsole({
      who: ADMIN,
      clients: [row("karan", "Karan Thind")],
      credentials: {},
    });
    const asked = () => calls.filter((u) => u.includes("/api/registry/clients")).length;

    await servableClients("kpi_token=alice");
    await servableClients("kpi_token=alice");
    expect(asked()).toBe(1);

    // A DIFFERENT COOKIE IS A DIFFERENT PERSON. If the cache were keyed on
    // anything coarser, this is the shape of the failure: one admin's client
    // list handed to whoever asked next.
    await servableClients("kpi_token=bob");
    expect(asked()).toBe(2);
  });

  it("never hands one client's keys to another", async () => {
    mockConsole({
      who: ADMIN,
      clients: [row("karan", "Karan Thind"), row("zennbot", "Zennbot")],
      credentials: { karan: creds("karan", "Karan Thind"), zennbot: creds("zennbot", "Zennbot") },
    });

    const a = await credentialsFor("karan");
    const b = await credentialsFor("zennbot");

    // The cache is keyed per client. If it ever is not, this is the shape the
    // failure takes: one client's Notion database under the other's name.
    expect(a?.notion.databaseId).toBe("db-karan");
    expect(b?.notion.databaseId).toBe("db-zennbot");
    expect(a?.notion.databaseId).not.toBe(b?.notion.databaseId);
  });
});

describe("a switch that cannot be completed renders nothing, and says why", () => {
  it("never renders the deployment's own client instead", async () => {
    // Listed, so the switcher offered it — and then the credential call fails.
    mockConsole({
      who: ADMIN,
      clients: [row("karan", "Karan Thind")],
      credentials: {},
    });

    const v = await resolveViewing("kpi_token=x", "karan");

    expect(v.switchError).toContain("Karan Thind");
    expect(v.chosen).toBeNull();
    // THE POINT. The old behaviour fell back to the environment client with a
    // banner, and the fallback's numbers rendered under the pinned client's
    // name in the bar. Null is what makes the page show the refusal alone.
    expect(v.config).toBeNull();
  });

  it("refuses a client that has dropped off the list, before asking for keys", async () => {
    const calls = mockConsole({
      who: ADMIN,
      clients: [row("brey", "Funded Blueprint")],
      credentials: { karan: creds("karan", "Karan Thind") },
    });

    const v = await resolveViewing("kpi_token=x", "karan");

    expect(v.config).toBeNull();
    expect(v.switchError).toContain("no longer one it can open");
    expect(calls.some((u) => u.includes("credentials/karan"))).toBe(false);
  });

  it("names the real reason when the pinned client has no tracker", async () => {
    // Karan's actual state on 2026-08-28: on the bar's roster (he has a KPI
    // sheet and a login) but with no Notion tracker, so this dashboard cannot
    // serve him. "No tracker connected" is a state; the old wording — archived
    // or disconnected — read as a fault.
    mockConsole({
      who: ADMIN,
      clients: [row("brey", "Funded Blueprint"), row("karan", "Karan Thind", { notion: false })],
    });

    const v = await resolveViewing("kpi_token=x", "karan");

    expect(v.config).toBeNull();
    expect(v.switchError).toContain("Karan Thind");
    expect(v.switchError).toContain("no sales tracker connected");
  });

  it("blames the console, not the client, when the roster never loaded", async () => {
    // The console is down. The pinned client is probably fine — a message
    // saying they were archived or disconnected sends whoever reads it to the
    // wrong place to fix it.
    // whoami answers admin; /api/registry/clients refuses → the roster never loads.
    mockConsole({ who: ADMIN });

    const v = await resolveViewing("kpi_token=x", "karan");

    expect(v.config).toBeNull();
    expect(v.switchError).toContain("console could not be reached");
    expect(v.switchError).not.toContain("archived");
  });

  it("names archived as archived", async () => {
    mockConsole({
      who: ADMIN,
      clients: [row("brey", "Funded Blueprint"), row("propfolio", "Propfolio", { status: "archived" })],
    });

    const v = await resolveViewing("kpi_token=x", "propfolio");

    expect(v.config).toBeNull();
    expect(v.switchError).toContain("Propfolio is archived");
  });
});

describe("who earns a place on the roster", () => {
  it("leaves out anyone the credentials endpoint would refuse, and anyone with no tracker", async () => {
    mockConsole({
      who: ADMIN,
      clients: [
        row("brey", "Funded Blueprint"),
        row("propfolio", "Propfolio", { status: "archived" }),
        row("zennbot", "Zennbot", { notion: false }),
      ],
    });

    const names = (await servableClients("kpi_token=x")).map((c) => c.name);

    expect(names).toEqual(["Funded Blueprint"]);
  });

  it("KEEPS the Lab's own account, which is the one we look at most", async () => {
    // Internal was refused here alongside archived, and the two were never the
    // same thing: archived is somebody who left, internal is us. The effect was
    // that this dashboard could be pointed at every client except ourselves.
    mockConsole({
      who: ADMIN,
      clients: [
        row("brey", "Funded Blueprint"),
        row("lab", "Perceptionism Lab", { internal: true }),
      ],
    });

    const names = (await servableClients("kpi_token=x")).map((c) => c.name);

    expect(names).toContain("Perceptionism Lab");
  });

  it("is empty when the console refuses the roster", async () => {
    mockConsole({ who: CLIENT });
    expect(await servableClients("kpi_token=x")).toEqual([]);
  });

  it("is empty for a visitor with no cookie at all", async () => {
    mockConsole({ who: ADMIN, clients: [row("brey", "Funded Blueprint")] });
    expect(await servableClients(null)).toEqual([]);
  });
});
