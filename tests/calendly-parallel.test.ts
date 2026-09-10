/**
 * The event-list crawl: what may overlap, and the one thing that must not.
 *
 * WHY THIS FILE EXISTS. The crawl reads three independent Calendly
 * collections — scheduled events with status=active, the same with
 * status=canceled, and the event-type names. All three ran one after another.
 * Measured against Brey's live account 2026-09-10, three runs: 3.3s + 2.9s +
 * 0.36s in sequence, against 3.4–4.6s for the pair together. Same eight
 * requests either way, so nothing extra is spent against Calendly's
 * 500-a-minute allowance.
 *
 * THE ONE THAT MUST STAY BEHIND is the event types, and the reason is easy to
 * lose. The events are read with organisation scope where the token allows it
 * and fall back to the user's own calendar on a 403. Event types are fetched
 * with whatever scope that fallback settled on. Move the call alongside the
 * events and it captures the ORIGINAL scope, takes the same 403, and is
 * swallowed by its own catch — leaving every booking filtered on its own name
 * rather than its type name. No error, no empty page: just the wrong bookings
 * counted as sales calls, on precisely the accounts where the fallback is
 * needed. That is what the last two tests here hold in place.
 *
 * Its own file because calendly.ts keeps the event list in module state and
 * vitest gives each file a fresh copy.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { queryBookings } from "../src/lib/calendly";

/* A DIFFERENT TOKEN PER TEST, and not for tidiness: calendly.ts caches the
   event list per ACCOUNT, hashed from the token. Sharing one across the tests
   in this file means the second test onward is served the first one's crawl
   and makes no requests at all — which reads as "the code did not do it"
   rather than "the code was never asked". Cost three failing tests to find. */
let tokenSeq = 0;
const cfg = () => ({ apiKey: `cal-token-parallel-${++tokenSeq}`, eventTypes: null });

type Call = { url: string; started: number; ended: number };

/**
 * A Calendly that answers slowly enough for overlap to be observable, and
 * records when each request was in flight.
 *
 * `forbidOrg` makes every organisation-scoped read 403, which is how a token
 * belonging to a team member rather than an owner behaves.
 */
function fakeCalendly(opts: { delayMs?: number; forbidOrg?: boolean } = {}) {
  const delay = opts.delayMs ?? 40;
  const calls: Call[] = [];

  const body = (url: string) => {
    if (url.includes("/users/me")) {
      return {
        resource: {
          uri: "https://api.calendly.com/users/U1",
          current_organization: "https://api.calendly.com/organizations/O1",
        },
      };
    }
    if (url.includes("/event_types")) {
      return { collection: [{ uri: "https://api.calendly.com/event_types/T1", name: "Sales Call" }] };
    }
    return { collection: [], pagination: { next_page: null } };
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const started = Date.now();
    await new Promise((r) => setTimeout(r, delay));
    calls.push({ url, started, ended: Date.now() });

    if (opts.forbidOrg && url.includes("organization=")) {
      return new Response(JSON.stringify({ message: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify(body(url)), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

/** Waits until `check` holds, or gives up — the crawl runs behind the caller. */
async function until(check: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

const matching = (calls: Call[], part: string) => calls.filter((c) => c.url.includes(part));
const overlap = (a: Call, b: Call) => a.started < b.ended && b.started < a.ended;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the event-list crawl", () => {
  it("reads the active and cancelled events at the same time, not one after the other", async () => {
    const calls = fakeCalendly();

    await queryBookings(new Date(), cfg());
    await until(() => matching(calls, "/event_types").length > 0);

    const active = matching(calls, "status=active");
    const canceled = matching(calls, "status=canceled");
    expect(active.length).toBe(1);
    expect(canceled.length).toBe(1);

    /* THE ASSERTION THAT MATTERS. Two requests that were in flight together
       overlap in time; two run in sequence cannot. Asserting on elapsed
       totals instead would pass on a fast enough machine whichever way the
       code read. */
    expect(overlap(active[0], canceled[0])).toBe(true);
  });

  it("asks for the event-type names only once the scope has settled", async () => {
    const calls = fakeCalendly();

    await queryBookings(new Date(), cfg());
    await until(() => matching(calls, "/event_types").length > 0);

    const events = [...matching(calls, "status=active"), ...matching(calls, "status=canceled")];
    const types = matching(calls, "/event_types")[0];

    // Started after the last event page finished — which is what makes it safe
    // for it to read the scope the fallback below may have just changed.
    expect(types.started).toBeGreaterThanOrEqual(Math.max(...events.map((e) => e.ended)));
  });

  it("falls back to the user's own calendar when the organisation is refused", async () => {
    const calls = fakeCalendly({ forbidOrg: true });

    await queryBookings(new Date(), cfg());
    await until(() => matching(calls, "user=").length >= 2);

    // Both statuses were retried, and both under the narrower scope.
    expect(matching(calls, "user=").filter((c) => c.url.includes("status=active")).length).toBe(1);
    expect(matching(calls, "user=").filter((c) => c.url.includes("status=canceled")).length).toBe(1);
  });

  it("and reads the event types under that narrower scope too, not the refused one", async () => {
    /* The regression this whole file exists for. Parallelising the event
       types alongside the events would send this one with organization=,
       take a 403, and swallow it — so the assertion is on WHICH scope the
       event-type request carried, not on whether one was made. */
    const calls = fakeCalendly({ forbidOrg: true });

    await queryBookings(new Date(), cfg());
    await until(() => matching(calls, "/event_types").some((c) => c.url.includes("user=")));

    const types = matching(calls, "/event_types");
    expect(types.length).toBeGreaterThan(0);
    expect(types.every((c) => c.url.includes("user="))).toBe(true);
    expect(types.some((c) => c.url.includes("organization="))).toBe(false);
  });
});
