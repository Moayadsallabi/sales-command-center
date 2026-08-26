/**
 * Whose dashboard is this request, and what does it take to render it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * Every credential this app needs used to come from its own environment, which
 * is why there is one deployment per client: a second client means a second
 * service, a second domain and a second copy of every variable. Resolving the
 * client per request is what collapses that into one deployment.
 *
 * ---------------------------------------------------------------------------
 * THE ENVIRONMENT IS STILL THE FALLBACK, AND THAT IS NOT TEMPORARY SCAFFOLDING
 *
 * A deployment that names a client in its own variables keeps working exactly
 * as it does today, unchanged, even if the registry is unreachable. That is
 * what makes this safe to ship to a live client dashboard: the new path has to
 * EARN its way in on each request, and failing to reach the registry costs
 * nothing rather than emptying the page.
 *
 * It also means the demo mode, local development and the Lab's own deployment
 * need no registry at all.
 */

/**
 * The shape the registry sends, snake_case, exactly as it comes off the wire.
 * Deliberately not renamed to camelCase here: the two names would then have to
 * be kept in step by hand across two repos, and a field that is silently
 * undefined reads as "this client has no Whop account" rather than as a typo.
 */
export type ProviderConfig = {
  api_key: string | null;
  account_id: string | null;
  config: Record<string, string | null>;
};

export type ClientConfig = {
  /** Registry id when the registry answered; null when this came from the environment. */
  clientId: string | null;
  /** The name to put in the header. */
  brandName: string | null;
  /** Where each value came from, so a page can say so rather than guess. */
  source: "registry" | "environment";
  notion: { apiKey: string | null; databaseId: string | null };
  calendly: { apiKey: string | null; eventTypes: string | null };
  whop: { apiKey: string | null };
};

/** What this deployment holds in its own variables. Always available. */
export function configFromEnvironment(): ClientConfig {
  return {
    clientId: process.env.CLIENT_ID?.trim() || null,
    brandName: process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || null,
    source: "environment",
    notion: {
      apiKey: process.env.NOTION_API_KEY ?? null,
      databaseId: process.env.NOTION_DATABASE_ID ?? null,
    },
    calendly: {
      apiKey: process.env.CALENDLY_API_KEY ?? null,
      eventTypes: process.env.CALENDLY_EVENT_TYPES ?? null,
    },
    whop: { apiKey: process.env.WHOP_API_KEY ?? null },
  };
}

/** The console's base address. One place, so a redeploy moves every call. */
function identityBase(): string {
  return process.env.IDENTITY_URL ?? "https://kpi.perceptionismlab.com";
}

/** Who is holding this cookie, as the console sees them. */
export type Viewer = {
  role: string;
  clientId: string | null;
  clientName: string | null;
};

/**
 * Ask the console who this visitor is.
 *
 * Split out from the credential fetch below because the two answer different
 * questions and are guarded differently: this reads the VISITOR'S cookie and
 * tells you nothing without it, while the credential call is server-to-server
 * and needs a token this app holds. Collapsing them would mean a cookie could
 * ask for credentials.
 *
 * Null on any failure -- unreachable, expired, malformed -- so every caller
 * treats "the console did not answer" as "nobody is signed in", which is the
 * safe reading in both directions.
 */
export async function whoami(cookieHeader: string | null): Promise<Viewer | null> {
  if (!cookieHeader) return null;
  try {
    const res = await fetch(identityBase() + "/api/session/whoami", {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const me = await res.json();
    if (!me?.authenticated) return null;
    return {
      role: String(me.role),
      clientId: me.client_id ?? null,
      clientName: me.client_name ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * One named client's credentials, server-to-server.
 *
 * THE CALLER HAS ALREADY DECIDED THIS IS ALLOWED. This function does not ask
 * who is looking -- it holds an internal token and would hand over anybody's
 * keys to anybody who reached it. Every path into it therefore establishes the
 * right to the client id FIRST: the visitor's own session, or an admin's
 * explicit choice checked against their role. Adding a caller that skips that
 * step is how one client reads another's calls.
 *
 * Null on ANY failure, so a registry outage degrades to the environment
 * instead of an empty dashboard.
 */
export async function credentialsFor(clientId: string): Promise<ClientConfig | null> {
  const token = process.env.REGISTRY_TOKEN;
  if (!token) return null;

  try {
    const credRes = await fetch(
      identityBase() + "/api/internal/credentials/" + encodeURIComponent(clientId),
      {
        headers: { "X-Internal-Token": token },
        cache: "no-store",
        signal: AbortSignal.timeout(4000),
      }
    );
    if (!credRes.ok) return null;
    const body = await credRes.json();
    const i = body?.integrations ?? {};
    const pick = (name: string): ProviderConfig =>
      i[name] ?? { api_key: null, account_id: null, config: {} };

    const notion = pick("notion");
    const calendly = pick("calendly");
    const whop = pick("whop");

    // A client with no Notion tracker cannot render this dashboard at all, and
    // half-applying a config -- their name with somebody else's calls -- is the
    // one outcome worse than falling back.
    if (!notion.api_key) return null;

    return {
      clientId,
      brandName: body?.client?.name ?? null,
      source: "registry",
      notion: {
        apiKey: notion.api_key ?? null,
        databaseId: (notion.config?.database_id as string) ?? notion.account_id ?? null,
      },
      calendly: {
        apiKey: calendly.api_key ?? null,
        eventTypes: (calendly.config?.event_types as string) ?? null,
      },
      whop: { apiKey: whop.api_key ?? null },
    };
  } catch {
    return null;
  }
}

/**
 * The visitor's OWN dashboard, from the registry.
 *
 * Unchanged in meaning from before the switcher existed: an admin is not a
 * client, so without a client of their own they get whatever this deployment
 * already names. The switcher is a separate, explicit path -- see
 * `servableClients` below.
 */
export async function configFromRegistry(
  cookieHeader: string | null,
  viewer?: Viewer | null
): Promise<ClientConfig | null> {
  const me = viewer !== undefined ? viewer : await whoami(cookieHeader);
  if (!me) return null;
  const clientId = me.clientId;
  if (!clientId) return null;
  const cfg = await credentialsFor(clientId);
  if (!cfg) return null;
  return { ...cfg, brandName: cfg.brandName ?? me.clientName ?? null };
}

/** A client an admin may point this dashboard at. Names only -- see below. */
export type ServableClient = { id: string; name: string };

/**
 * THE ADMIN'S CLIENT LIST, AND ONLY THE ADMIN'S.
 *
 * Guarded at the console, not here. `/api/registry/clients` already answers 403
 * to a client session, so a client asking gets an empty list by the same rule
 * that stops them reading the roster anywhere else -- rather than by a check
 * written a second time in this repo, which is the drift that has cost this
 * workspace before. The visitor's own cookie is forwarded so the console is
 * deciding about the person actually looking.
 *
 * WHAT EARNS A PLACE ON THE LIST: a Notion tracker that is actually connected.
 * Not the `sales` surface -- that records what a CLIENT is entitled to open,
 * and this list is read by the agency, who are not bound by it. The question
 * here is only "can this client's dashboard render", and Notion is the whole of
 * the answer: it holds the calls, and everything else on the page is optional.
 *
 * Archived and internal clients are left out because the credentials endpoint
 * REFUSES them. That is not a second opinion about who should be listed; it is
 * this list agreeing with the server, so that every name on it can be clicked.
 */
export async function servableClients(cookieHeader: string | null): Promise<ServableClient[]> {
  if (!cookieHeader) return [];
  try {
    const res = await fetch(identityBase() + "/api/registry/clients", {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];   // 403 for a client session, and that is the point
    const body = await res.json();
    const rows: Array<{
      id: string;
      name: string;
      status: string;
      is_internal: boolean;
      integrations?: Array<{ provider: string; configured: boolean }>;
    }> = body?.clients ?? [];

    return rows
      // Archived only. Internal is the LAB'S OWN account -- its own sales calls,
      // the ones Moayad looks at most -- and refusing it meant this dashboard
      // could be pointed at every client except us. Nothing about isolation
      // rests on that flag; the admin check above is what carries it.
      .filter((c) => c.status !== "archived")
      .filter((c) => (c.integrations ?? []).some((i) => i.provider === "notion" && i.configured))
      .map((c) => ({ id: c.id, name: c.name }));
  } catch {
    return [];
  }
}

/** The registry when it can answer for this visitor, this deployment otherwise. */
export async function resolveClientConfig(
  cookieHeader: string | null,
  viewer?: Viewer | null
): Promise<ClientConfig> {
  return (await configFromRegistry(cookieHeader, viewer)) ?? configFromEnvironment();
}

/* -------------------------------------------------------- the switcher */

/**
 * WHERE THE CHOICE OF CLIENT LIVES, AND WHY IT IS NOT THIS APP'S.
 *
 * Written and cleared by the identity service, on the whole
 * perceptionismlab.com domain, so the KPI dashboard, this app and the calendar
 * all read the same answer. It began as a cookie of this app's own, which
 * worked and was wrong: picking a client here meant nothing anywhere else, and
 * the same question had to be answered again in each system. That is the whole
 * reason three apps sharing a login still read as three products.
 *
 * This app only ever READS it. The bar across the top of every page is what
 * writes it — see public/shell.js in the KPI service.
 *
 * It is httpOnly because nothing in the browser needs to read it: the server
 * renders whose dashboard this is into the page already.
 */
export const VIEWING_COOKIE = "lab_client";

export type Viewing = {
  /** The credentials every read on the page goes through. */
  config: ClientConfig;
  /** Who this visitor may switch to. EMPTY for everyone who is not an admin. */
  clients: ServableClient[];
  /** The client currently pinned by the switcher, when one is. */
  chosen: string | null;
  /**
   * Set when a pinned client could not be opened.
   *
   * It exists so the page can SAY so. Falling back silently would render the
   * deployment's own client under a heading the admin believes says somebody
   * else — one client's numbers read as another's, which is the single worst
   * outcome this file is arranged to prevent.
   */
  switchError: string | null;
};

/**
 * Whose dashboard to render, and what the switcher may offer.
 *
 * THE ROLE IS CHECKED HERE, ON EVERY REQUEST, against the console — never
 * against anything the browser sent. The cookie above carries a client id and
 * nothing else; on its own it is a request, not a permission. A client who
 * copies an admin's cookie value gets their own dashboard, because the id is
 * only ever honoured after `whoami` comes back `admin`.
 */
export async function resolveViewing(
  cookieHeader: string | null,
  chosen: string | null
): Promise<Viewing> {
  const me = await whoami(cookieHeader);
  const fallback = () => resolveClientConfig(cookieHeader, me);

  // Not an admin: the switcher does not exist, and a pinned id is ignored
  // rather than refused. There is nothing to tell them — the cookie is not
  // theirs to have used.
  if (me?.role !== "admin") {
    return { config: await fallback(), clients: [], chosen: null, switchError: null };
  }

  const clients = await servableClients(cookieHeader);
  if (!chosen) {
    return { config: await fallback(), clients, chosen: null, switchError: null };
  }

  // A pinned client that has since been archived, had its tracker removed, or
  // was never on the list. Checked before the credential call so the answer
  // comes from the same list the switcher offered, rather than from a 403.
  const named = clients.find((c) => c.id === chosen);
  if (!named) {
    return {
      config: await fallback(),
      clients,
      chosen: null,
      switchError:
        "The client this dashboard was pointed at is no longer one it can open — " +
        "archived, or their sales tracker has been disconnected.",
    };
  }

  const cfg = await credentialsFor(chosen);
  if (!cfg) {
    return {
      config: await fallback(),
      clients,
      chosen: null,
      switchError:
        `${named.name}'s dashboard could not be opened: the registry did not return their keys. ` +
        "Every number below belongs to whoever this deployment is named after, not to them.",
    };
  }

  return {
    config: { ...cfg, brandName: cfg.brandName ?? named.name },
    clients,
    chosen,
    switchError: null,
  };
}
