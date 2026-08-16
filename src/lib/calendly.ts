/**
 * Calendly reads: what was booked, as opposed to what got recorded.
 *
 * The rest of the dashboard is built on Fathom recordings arriving in Notion,
 * which means it can only see calls somebody hit record on. A prospect who
 * cancels the night before, or books and never turns up, leaves no recording
 * and so leaves no trace at all — and a show rate whose denominator is
 * recordings is not a show rate. This module supplies the real denominator.
 *
 * Nothing is stored. Bookings are read at request time exactly as Notion rows
 * are, with a short in-process cache in front because each booking costs a
 * second request to Calendly for its invitee.
 *
 * The whole module is optional. With no token set, `queryBookings` reports
 * `not-configured` and every panel falls back to the recording-based numbers,
 * which is what most installs will run on until the client connects Calendly.
 */

/** Why a Calendly read failed, in terms the dashboard can explain. */
export type CalendlyFailure =
  | { kind: "not-configured" }
  | { kind: "unauthorized" }
  | { kind: "forbidden"; detail: string }
  | { kind: "api"; status: number; detail: string }
  | { kind: "network"; detail: string };

export class CalendlyError extends Error {
  readonly failure: CalendlyFailure;

  constructor(failure: CalendlyFailure, message: string) {
    super(message);
    this.name = "CalendlyError";
    this.failure = failure;
  }
}

/** The utm parameters carried on the booking link. */
export interface BookingTracking {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  content: string | null;
  term: string | null;
}

export interface BookingAnswer {
  question: string;
  answer: string;
}

export interface BookingRecord {
  /** The invitee uri — unique per person per booking, and stable across reads. */
  id: string;
  /** The scheduled event this invitee belongs to. */
  event_id: string;
  /** The event type as named in Calendly, e.g. "Strategy Call". */
  event_type: string | null;
  name: string;
  /** Lower-cased. This is the key every join in the dashboard runs on. */
  email: string;
  /** When the booking was made. */
  booked_at: string | null;
  /** When the call was due to start, as an ISO timestamp. */
  scheduled_at: string;
  /** Days between making the booking and the call itself. */
  lead_time_days: number | null;
  status: "active" | "canceled";
  /** "invitee" or "host" — who pulled out, when it was canceled. */
  canceled_by_side: string | null;
  canceled_by: string | null;
  cancel_reason: string | null;
  canceled_at: string | null;
  /**
   * Hours of notice the cancellation gave. Negative when it landed after the
   * call was due to start, which is a no-show wearing a cancellation's coat.
   */
  cancel_notice_hours: number | null;
  /** Calendly's own no-show mark. Only true when a human actually set it. */
  marked_no_show: boolean;
  /** This booking is the replacement for one the invitee moved. */
  rescheduled: boolean;
  /** Who Calendly assigned the call to, which round-robin decides. */
  host: string | null;
  host_email: string | null;
  tracking: BookingTracking;
  /** Their answers on the booking form, in the order Calendly returns them. */
  answers: BookingAnswer[];
}

export interface BookingsResult {
  bookings: BookingRecord[];
  /**
   * The earliest scheduled time this read covers. Anything before it is not
   * absent, just unfetched — the panels say so rather than reporting zero.
   */
  window_start: string;
  /** Whether the token reached the whole organisation or just one user. */
  scope: "organization" | "user";
  /** Event type names kept, or null when every type counted. */
  event_types: string[] | null;
  /** Bookings dropped for being on a non-sales event type. */
  filtered_out: number;
  /**
   * Bookings still being read. Above zero the set is incomplete, so no rate
   * derived from it can be trusted yet — the dashboard shows the recording
   * numbers and says it is still reading rather than quoting a partial figure.
   */
  pending: number;
  /** Sales bookings in the window, whether or not they have been read yet. */
  total: number;
}

const API = "https://api.calendly.com";

/** How long the event list is reused before Calendly is asked again. */
const DEFAULT_CACHE_SECONDS = 300;
/** How far back to read. Bookings older than this are not fetched at all. */
const DEFAULT_LOOKBACK_DAYS = 90;
/**
 * Simultaneous invitee requests. Calendly allows 500 a minute on the teams
 * tier, and the governor below is what actually keeps us inside that — this
 * only decides how fast the first fill goes.
 */
const CONCURRENCY = 8;
/**
 * Stop and wait for the window to reset with this much of the allowance left.
 * A margin rather than zero, because several requests are always in flight.
 */
const RATE_FLOOR = 25;
/** How long an event's invitees stay usable. A finished call does not change. */
const INVITEE_TTL_MS = 12 * 3600_000;

/* ------------------------------------------------------------ http plumbing */

type CalendlyPagination = { next_page?: string | null };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * How much of Calendly's allowance is left, read off every response.
 *
 * The limit is per token and counted over a rolling window — 500 a minute on
 * the teams tier. Reading a few hundred bookings goes through it in one burst,
 * so the choice is between honouring it and being refused a quarter of the
 * time. Requests wait here when the allowance runs low rather than firing and
 * being rejected, which is both faster and kinder to the account.
 */
const budget = { remaining: Infinity, resetAt: 0 };

function noteLimits(headers: Headers): void {
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  const reset = Number(headers.get("x-ratelimit-reset"));
  if (Number.isFinite(remaining)) budget.remaining = remaining;
  if (Number.isFinite(reset)) budget.resetAt = Date.now() + reset * 1000;
}

async function waitForAllowance(): Promise<void> {
  while (budget.remaining <= RATE_FLOOR && Date.now() < budget.resetAt) {
    await sleep(Math.min(budget.resetAt - Date.now(), 5000) + 250);
    // Whoever returns first past the reset clears the pause for everyone; the
    // next response's headers put the real number back.
    if (Date.now() >= budget.resetAt) budget.remaining = Infinity;
  }
}

async function request<T>(
  target: string,
  token: string,
  params?: Record<string, string | undefined>
): Promise<T> {
  // Built only when there are params to add. A url Calendly handed us is sent
  // back byte for byte — see `collect` for why that matters.
  let url = target.startsWith("http") ? target : `${API}${target}`;
  if (params) {
    const built = new URL(url);
    for (const [key, value] of Object.entries(params)) {
      if (value != null) built.searchParams.set(key, value);
    }
    url = built.toString();
  }

  let lastDetail = "";
  for (let attempt = 0; attempt < 5; attempt++) {
    await waitForAllowance();

    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      });
    } catch (err) {
      throw new CalendlyError(
        { kind: "network", detail: String(err) },
        `Could not reach Calendly: ${err}`
      );
    }

    noteLimits(resp.headers);

    if (resp.ok) return (await resp.json()) as T;

    lastDetail = await resp.text();

    if (resp.status === 401) {
      throw new CalendlyError({ kind: "unauthorized" }, lastDetail);
    }
    if (resp.status === 403) {
      throw new CalendlyError({ kind: "forbidden", detail: lastDetail }, lastDetail);
    }
    if (resp.status === 429) {
      // Being refused means the allowance is genuinely gone, whatever the last
      // headers said. Wait out the window rather than retrying into it.
      const retryAfter = Number(resp.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter)
        ? retryAfter * 1000
        : Math.max(budget.resetAt - Date.now(), 1000);
      budget.remaining = 0;
      await sleep(Math.min(wait, 65_000) + 250);
      budget.remaining = Infinity;
      continue;
    }
    if (resp.status >= 500) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    throw new CalendlyError(
      { kind: "api", status: resp.status, detail: lastDetail },
      lastDetail
    );
  }

  throw new CalendlyError(
    { kind: "api", status: 429, detail: lastDetail },
    `Calendly kept refusing the request: ${lastDetail}`
  );
}

/**
 * Walks every page of a Calendly collection endpoint.
 *
 * Pages are followed by requesting `pagination.next_page` exactly as Calendly
 * wrote it, rather than re-sending the original parameters with the page token
 * added. **A page token is only valid against the precise query string it was
 * issued for** — Calendly normalises timestamps to microseconds, so a
 * `min_start_time` built from JavaScript's `toISOString()` comes back as
 * `…10.352000Z` against the `…10.352Z` that was sent, and reusing the token
 * with the original value is rejected with `400 page_token is invalid`. So is
 * dropping a parameter, or sending the token on its own.
 *
 * The failure only appears past the first 100 records, which is why it has to
 * be written down rather than discovered again: an account with 90 bookings
 * works perfectly and one with 110 fails outright.
 */
async function collect<T>(
  path: string,
  token: string,
  params: Record<string, string | undefined>
): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = null;

  do {
    const data: { collection?: T[]; pagination?: CalendlyPagination } = next
      ? await request(next, token)
      : await request(path, token, { ...params, count: "100" });
    out.push(...(data.collection ?? []));
    next = data.pagination?.next_page ?? null;
  } while (next);

  return out;
}

/** Runs `work` over `items` a few at a time rather than all at once. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );
  return results;
}

/* ------------------------------------------------------- Calendly payloads */

type ScheduledEvent = {
  uri?: string;
  name?: string;
  status?: string;
  start_time?: string;
  end_time?: string;
  created_at?: string;
  event_type?: string;
  event_memberships?: { user?: string; user_name?: string; user_email?: string }[];
  cancellation?: {
    canceled_by?: string;
    reason?: string;
    canceler_type?: string;
    created_at?: string;
  } | null;
};

type Invitee = {
  uri?: string;
  email?: string;
  name?: string;
  status?: string;
  created_at?: string;
  rescheduled?: boolean;
  no_show?: { uri?: string; created_at?: string } | null;
  questions_and_answers?: { question?: string; answer?: string; position?: number }[];
  tracking?: {
    utm_source?: string | null;
    utm_medium?: string | null;
    utm_campaign?: string | null;
    utm_content?: string | null;
    utm_term?: string | null;
  } | null;
  cancellation?: {
    canceled_by?: string;
    reason?: string;
    canceler_type?: string;
    created_at?: string;
  } | null;
};

type EventType = { uri?: string; name?: string; slug?: string };

/* ----------------------------------------------------------------- mapping */

function text(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

function hoursBetween(from: string, to: string): number | null {
  const a = Date.parse(from);
  const b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / 36e5;
}

/** The uuid tail of a Calendly uri, which is what path endpoints take. */
function uuidOf(uri: string): string {
  return uri.split("/").filter(Boolean).pop() ?? "";
}

function toBooking(
  event: ScheduledEvent,
  invitee: Invitee,
  eventTypeNames: Map<string, string>
): BookingRecord | null {
  const scheduled = event.start_time;
  const email = text(invitee.email)?.toLowerCase();
  // Without a scheduled time there is nothing to place on a timeline, and
  // without an email there is nothing to join a recording to. Either missing
  // makes the row unusable rather than partly usable.
  if (!scheduled || !email) return null;

  const cancellation = invitee.cancellation ?? event.cancellation ?? null;
  const canceledAt = text(cancellation?.created_at);
  const bookedAt = text(invitee.created_at) ?? text(event.created_at);
  const membership = event.event_memberships?.[0];

  const leadHours = bookedAt ? hoursBetween(bookedAt, scheduled) : null;

  return {
    id: invitee.uri ?? `${event.uri}#${email}`,
    event_id: event.uri ?? "",
    event_type:
      (event.event_type ? eventTypeNames.get(event.event_type) : null) ??
      text(event.name),
    name: text(invitee.name) ?? "",
    email,
    booked_at: bookedAt,
    scheduled_at: scheduled,
    lead_time_days: leadHours == null ? null : leadHours / 24,
    // A canceled invitee on an otherwise live event is still a cancellation:
    // one of two people pulled out, and their seat is what we are counting.
    status:
      invitee.status === "canceled" || event.status === "canceled"
        ? "canceled"
        : "active",
    canceled_by_side: text(cancellation?.canceler_type),
    canceled_by: text(cancellation?.canceled_by),
    cancel_reason: text(cancellation?.reason),
    canceled_at: canceledAt,
    cancel_notice_hours: canceledAt ? hoursBetween(canceledAt, scheduled) : null,
    marked_no_show: invitee.no_show != null,
    rescheduled: invitee.rescheduled === true,
    host: text(membership?.user_name),
    host_email: text(membership?.user_email)?.toLowerCase() ?? null,
    tracking: {
      source: text(invitee.tracking?.utm_source),
      medium: text(invitee.tracking?.utm_medium),
      campaign: text(invitee.tracking?.utm_campaign),
      content: text(invitee.tracking?.utm_content),
      term: text(invitee.tracking?.utm_term),
    },
    answers: (invitee.questions_and_answers ?? [])
      .map((qa) => ({
        question: text(qa.question) ?? "",
        answer: text(qa.answer) ?? "",
      }))
      .filter((qa) => qa.question !== "" && qa.answer !== ""),
  };
}

/* ------------------------------------------------------------------- cache */

/**
 * What has been read so far, kept between requests.
 *
 * The event list is cheap — a handful of requests for hundreds of bookings.
 * The invitees are not: one request each, and that is where the email, the utm
 * tags and the form answers live. On a busy account that is several hundred
 * requests, more than a minute's allowance, which is why they are cached by
 * event and kept rather than re-read.
 *
 * A finished call's invitees do not change, so the entry stays usable for
 * hours. Anything still ahead of us is left out of the cache entirely — it can
 * still be rescheduled or cancelled, and a stale row there would be wrong in
 * the one direction that matters.
 *
 * This lives in the process, so a redeploy starts cold. That is handled by
 * serving what is ready and filling the rest in the background, rather than by
 * making the first person to open the dashboard wait for it.
 */
type Store = {
  key: string;
  listedAt: number;
  scope: BookingsResult["scope"];
  windowStart: string;
  events: ScheduledEvent[];
  typeNames: Map<string, string>;
  filteredOut: number;
  invitees: Map<string, { at: number; bookings: BookingRecord[] }>;
  filling: boolean;
};

let store: Store | null = null;

function cacheSeconds(): number {
  const raw = Number(process.env.CALENDLY_CACHE_SECONDS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CACHE_SECONDS;
}

function lookbackDays(): number {
  const raw = Number(process.env.CALENDLY_LOOKBACK_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_LOOKBACK_DAYS;
}

/**
 * Which event types count as sales calls, lower-cased. Unset means every type
 * counts, which will sweep in one-to-ones and personal meetings — so the
 * setup docs push hard on naming them.
 */
function salesEventTypes(): string[] | null {
  const raw = process.env.CALENDLY_EVENT_TYPES;
  if (!raw || raw.trim() === "") return null;
  const names = raw
    .split(",")
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n !== "");
  return names.length > 0 ? names : null;
}

export function isCalendlyConfigured(): boolean {
  return (process.env.CALENDLY_API_KEY ?? "").trim() !== "";
}

/* ------------------------------------------------------------------ public */

/** Lists the sales events in the window and puts them in the store. */
async function refreshEventList(token: string, now: Date, key: string): Promise<Store> {
  const windowStart = new Date(now.getTime() - lookbackDays() * 864e5).toISOString();
  // Far enough ahead to cover anything already on the calendar. Upcoming
  // bookings are shown separately and never counted as shows or no-shows.
  const windowEnd = new Date(now.getTime() + 365 * 864e5).toISOString();
  const wanted = salesEventTypes();

  const me = await request<{
    resource?: { uri?: string; current_organization?: string };
  }>("/users/me", token);

  const userUri = me.resource?.uri;
  const orgUri = me.resource?.current_organization;

  // Organisation scope covers every closer's calendar, which is the point on a
  // team. It needs an admin or owner token, so a member's token falls back to
  // their own calendar rather than failing the whole read.
  let scope: BookingsResult["scope"] = orgUri ? "organization" : "user";
  const scopeParams = (): Record<string, string | undefined> =>
    scope === "organization" ? { organization: orgUri } : { user: userUri };

  // Calendly's status filter takes one value at a time, and a cancellation is
  // the most interesting thing this module reads, so it is asked for outright
  // rather than left to whatever the default returns.
  const listEvents = (status: "active" | "canceled") =>
    collect<ScheduledEvent>("/scheduled_events", token, {
      ...scopeParams(),
      status,
      min_start_time: windowStart,
      max_start_time: windowEnd,
    });

  let events: ScheduledEvent[];
  try {
    events = (await listEvents("active")).concat(await listEvents("canceled"));
  } catch (err) {
    if (err instanceof CalendlyError && err.failure.kind === "forbidden" && userUri) {
      scope = "user";
      events = (await listEvents("active")).concat(await listEvents("canceled"));
    } else {
      throw err;
    }
  }

  // Event types are named on their own resource; the event only carries a uri.
  // Resolving them means the filter below can be written as the name a human
  // sees in Calendly rather than an opaque id.
  const typeNames = new Map<string, string>();
  try {
    for (const type of await collect<EventType>("/event_types", token, scopeParams())) {
      if (type.uri && type.name) typeNames.set(type.uri, type.name);
    }
  } catch {
    // A token without event-type access still gives usable bookings — the
    // event's own name stands in, and the filter matches on that instead.
  }

  const matchesType = (event: ScheduledEvent): boolean => {
    if (!wanted) return true;
    const name = (
      (event.event_type ? typeNames.get(event.event_type) : null) ??
      event.name ??
      ""
    ).toLowerCase();
    return wanted.some((w) => name === w || name.includes(w));
  };

  const kept = events.filter((e) => e.uri && matchesType(e));

  return {
    key,
    listedAt: Date.now(),
    scope,
    windowStart,
    events: kept,
    typeNames,
    filteredOut: events.length - kept.length,
    // Invitees already read stay read — the whole point of keeping them.
    invitees: store?.key === key ? store.invitees : new Map(),
    filling: false,
  };
}

/**
 * Events whose invitees have never been read. This is what "pending" means to
 * the dashboard: bookings it has no information about at all, and therefore
 * cannot include in any rate.
 */
function neverRead(current: Store): ScheduledEvent[] {
  return current.events.filter((event) => !current.invitees.has(event.uri as string));
}

/**
 * Events due another read — never read, or read long enough ago to have moved.
 *
 * A call still ahead of us is refreshed on the ordinary cache interval, because
 * it can be rescheduled or called off and that is the change this whole feature
 * exists to catch. A call that has already happened is settled and holds for
 * hours.
 *
 * Kept separate from `neverRead` on purpose. Folding the two together is what
 * made every upcoming booking count as pending forever, which left the funnel
 * permanently waiting on a read that had in fact already finished.
 */
function needsRefresh(current: Store, now: number): ScheduledEvent[] {
  return current.events.filter((event) => {
    const entry = current.invitees.get(event.uri as string);
    if (!entry) return true;
    const settled = Date.parse(event.start_time ?? "") < now;
    const ttl = settled ? INVITEE_TTL_MS : cacheSeconds() * 1000;
    return now - entry.at > ttl;
  });
}

/**
 * Reads the invitees still missing, a few at a time, into the store.
 *
 * Deliberately not awaited by the request that starts it. On a busy account
 * the first fill is several hundred requests and more than a minute of
 * Calendly's allowance; making someone opening the dashboard wait for that
 * would be worse than showing them the recordings while it happens. The page
 * already reloads itself every sixty seconds, so the funnel appears on its own.
 */
async function fillInvitees(current: Store, token: string): Promise<void> {
  if (current.filling) return;
  current.filling = true;

  try {
    const due = needsRefresh(current, Date.now());
    await pooled(due, CONCURRENCY, async (event) => {
      const uri = event.uri as string;
      try {
        const invitees = await collect<Invitee>(
          `/scheduled_events/${uuidOf(uri)}/invitees`,
          token,
          {}
        );
        const bookings = invitees
          .map((invitee) => toBooking(event, invitee, current.typeNames))
          .filter((b): b is BookingRecord => b !== null);

        current.invitees.set(uri, { at: Date.now(), bookings });
      } catch (err) {
        // One unreadable booking should not abandon the other six hundred.
        // It stays unread and is retried on the next pass.
        console.error(`Calendly: could not read invitees for ${uri}:`, err);
      }
    });
  } finally {
    current.filling = false;
  }
}

/* ------------------------------------------------------------------ public */

/**
 * Every sales booking in the lookback window that has been read so far, plus
 * anything already on the calendar ahead of today.
 *
 * Returns immediately with whatever is in hand. `pending` says how much is
 * still coming — above zero the set is incomplete and no rate off it means
 * anything yet, which is why the dashboard falls back to the recording numbers
 * until it reaches zero.
 */
export async function queryBookings(now: Date = new Date()): Promise<BookingsResult> {
  const token = (process.env.CALENDLY_API_KEY ?? "").trim();
  if (token === "") {
    throw new CalendlyError(
      { kind: "not-configured" },
      "CALENDLY_API_KEY is not set."
    );
  }

  const wanted = salesEventTypes();
  const key = `${lookbackDays()}|${wanted?.join(",") ?? "*"}`;

  const listStale =
    !store ||
    store.key !== key ||
    (Date.now() - store.listedAt) / 1000 >= cacheSeconds();

  if (listStale) store = await refreshEventList(token, now, key);
  const current = store as Store;

  if (needsRefresh(current, Date.now()).length > 0 && !current.filling) {
    // Started, not awaited. Errors are handled inside; this catch only stops an
    // unhandled rejection from taking the process down.
    void fillInvitees(current, token).catch((err) =>
      console.error("Calendly: booking fill failed:", err)
    );
  }

  const bookings = current.events
    .flatMap((event) => current.invitees.get(event.uri as string)?.bookings ?? [])
    // A rescheduled booking leaves the original behind as a canceled row.
    // Both are kept — the reschedule is the finding — and sorted so the
    // newest attempt for a person reads first.
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));

  return {
    bookings,
    window_start: current.windowStart,
    scope: current.scope,
    event_types: wanted,
    filtered_out: current.filteredOut,
    pending: neverRead(current).length,
    total: current.events.length,
  };
}
