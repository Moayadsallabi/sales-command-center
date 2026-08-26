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

/**
 * Ask the console who this is, then ask it for their credentials.
 *
 * Two calls rather than one because they answer different questions and are
 * guarded differently: whoami reads the visitor's own cookie and tells you
 * nothing without it, while the credentials call is server-to-server and needs
 * a token this app holds. Collapsing them would mean a cookie could ask for
 * credentials.
 *
 * Returns null on ANY failure -- unreachable, unauthorised, no session, no
 * client. The caller falls back to the environment, so a registry outage
 * degrades to today's behaviour instead of an empty dashboard.
 */
export async function configFromRegistry(cookieHeader: string | null): Promise<ClientConfig | null> {
  if (!cookieHeader) return null;
  const base = process.env.IDENTITY_URL ?? "https://kpi.perceptionismlab.com";
  const token = process.env.REGISTRY_TOKEN;
  if (!token) return null;

  try {
    const meRes = await fetch(base + "/api/session/whoami", {
      headers: { Cookie: cookieHeader },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
    if (!meRes.ok) return null;
    const me = await meRes.json();
    if (!me?.authenticated) return null;

    // An admin is not a client. Without a client to render they get whatever
    // this deployment already names, rather than an arbitrary one.
    const clientId: string | null = me.client_id ?? null;
    if (!clientId) return null;

    const credRes = await fetch(base + "/api/internal/credentials/" + encodeURIComponent(clientId), {
      headers: { "X-Internal-Token": token },
      cache: "no-store",
      signal: AbortSignal.timeout(4000),
    });
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
      brandName: body?.client?.name ?? me.client_name ?? null,
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

/** The registry when it can answer for this visitor, this deployment otherwise. */
export async function resolveClientConfig(cookieHeader: string | null): Promise<ClientConfig> {
  return (await configFromRegistry(cookieHeader)) ?? configFromEnvironment();
}
