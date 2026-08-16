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
}

const API = "https://api.calendly.com";

/** Calendly is a second network hop per booking, so reads are cached briefly. */
const DEFAULT_CACHE_SECONDS = 300;
/** How far back to read. Bookings older than this are not fetched at all. */
const DEFAULT_LOOKBACK_DAYS = 180;
/** Simultaneous invitee requests. Kept low so a big window cannot get rate-limited. */
const CONCURRENCY = 5;

/* ------------------------------------------------------------ http plumbing */

type CalendlyPagination = { next_page_token?: string | null };

async function request<T>(
  path: string,
  token: string,
  params?: Record<string, string | undefined>
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${API}${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value != null) url.searchParams.set(key, value);
  }

  let lastDetail = "";
  // Calendly rate-limits per token, and a dashboard that auto-refreshes can
  // walk into it. Two retries turn that into a slow read rather than a failed one.
  for (let attempt = 0; attempt < 3; attempt++) {
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

    if (resp.ok) return (await resp.json()) as T;

    lastDetail = await resp.text();

    if (resp.status === 401) {
      throw new CalendlyError({ kind: "unauthorized" }, lastDetail);
    }
    if (resp.status === 403) {
      throw new CalendlyError({ kind: "forbidden", detail: lastDetail }, lastDetail);
    }
    if (resp.status === 429 || resp.status >= 500) {
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      continue;
    }
    throw new CalendlyError(
      { kind: "api", status: resp.status, detail: lastDetail },
      lastDetail
    );
  }

  throw new CalendlyError(
    { kind: "api", status: 429, detail: lastDetail },
    `Calendly kept rate-limiting the request: ${lastDetail}`
  );
}

/** Walks every page of a Calendly collection endpoint. */
async function collect<T>(
  path: string,
  token: string,
  params: Record<string, string | undefined>
): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;

  do {
    const data = await request<{ collection?: T[]; pagination?: CalendlyPagination }>(
      path,
      token,
      { ...params, count: "100", page_token: pageToken }
    );
    out.push(...(data.collection ?? []));
    pageToken = data.pagination?.next_page_token ?? undefined;
  } while (pageToken);

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

type CacheEntry = { at: number; value: BookingsResult };
const cache = new Map<string, CacheEntry>();

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

/**
 * Every sales booking in the lookback window, plus anything already on the
 * calendar ahead of today.
 *
 * Two requests list the events — Calendly's status filter takes one value at a
 * time, and a cancellation is the single most interesting thing this module
 * fetches, so it is asked for explicitly rather than left to a default. Each
 * event then costs one more request for its invitee, which is where the email,
 * the utm tags, the booking-form answers and the no-show mark live.
 */
export async function queryBookings(now: Date = new Date()): Promise<BookingsResult> {
  const token = (process.env.CALENDLY_API_KEY ?? "").trim();
  if (token === "") {
    throw new CalendlyError(
      { kind: "not-configured" },
      "CALENDLY_API_KEY is not set."
    );
  }

  const windowStart = new Date(now.getTime() - lookbackDays() * 864e5).toISOString();
  // Far enough ahead to cover anything already on the calendar. Upcoming
  // bookings are shown separately and never counted as shows or no-shows.
  const windowEnd = new Date(now.getTime() + 365 * 864e5).toISOString();
  const wanted = salesEventTypes();
  const key = `${windowStart.slice(0, 13)}|${wanted?.join(",") ?? "*"}`;

  const hit = cache.get(key);
  if (hit && (Date.now() - hit.at) / 1000 < cacheSeconds()) return hit.value;

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

  async function listEvents(status: "active" | "canceled"): Promise<ScheduledEvent[]> {
    return collect<ScheduledEvent>("/scheduled_events", token, {
      ...scopeParams(),
      status,
      min_start_time: windowStart,
      max_start_time: windowEnd,
      sort: "start_time:asc",
    });
  }

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

  const kept = events.filter(matchesType);
  const filteredOut = events.length - kept.length;

  const perEvent = await pooled(kept, CONCURRENCY, async (event) => {
    if (!event.uri) return [] as BookingRecord[];
    const invitees = await collect<Invitee>(
      `/scheduled_events/${uuidOf(event.uri)}/invitees`,
      token,
      {}
    );
    return invitees
      .map((invitee) => toBooking(event, invitee, typeNames))
      .filter((b): b is BookingRecord => b !== null);
  });

  const bookings = perEvent
    .flat()
    // A rescheduled booking leaves the original behind as a canceled row.
    // Both are kept — the reschedule is the finding — and sorted so the
    // newest attempt for a person reads first.
    .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at));

  const value: BookingsResult = {
    bookings,
    window_start: windowStart,
    scope,
    event_types: wanted,
    filtered_out: filteredOut,
  };

  cache.set(key, { at: Date.now(), value });
  return value;
}
