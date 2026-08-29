import { queryAllCalls, NotionError, NotionFailure } from "@/lib/notion";
import { queryBookings, isCalendlyConfigured, CalendlyError } from "@/lib/calendly";
import { queryPayments, isWhopConfigured, WhopRead } from "@/lib/whop";
import { linkBookings, CalendlyState } from "@/lib/bookings";
import { CallRecord } from "@/lib/types";
import { reconcile } from "@/lib/reconcile";
import { partitionCalls } from "@/lib/excluded-calls";
import { settle } from "@/lib/settle";
import { Dashboard } from "@/components/dashboard/dashboard";
import { ClientConfig, VIEWING_COOKIE } from "@/lib/client-config";
import { currentViewing } from "@/lib/viewing-request";
import { cookies } from "next/headers";
import { SetupNotice } from "@/components/dashboard/setup-notice";
import { SwitchRefused } from "@/components/dashboard/switch-refused";

export const dynamic = "force-dynamic";

/**
 * Times one step of the render and says so when it was slow.
 *
 * There was no way to tell WHERE a slow page went. On 2026-08-27 a first load
 * measured 132 seconds against the live account while every load after it was
 * under 300ms, and reading the code produced three plausible culprits and no
 * way to choose between them. A number in the log settles it in one reload.
 *
 * Only slow steps are logged: a line per step per render would drown the log
 * that matters, and a step that took 40ms is not information. The bar is 400ms
 * rather than the 1.5s it started at, because the page is now fast enough that
 * 1.5s hides everything worth seeing — the costs left are in the hundreds.
 */
const SLOW_MS = 400;

async function timed<T>(step: string, work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    const took = Date.now() - started;
    if (took >= SLOW_MS) console.log(`[slow] ${step} took ${took}ms`);
  }
}

type LoadResult =
  | { ok: true; calls: CallRecord[] }
  | { ok: false; failure: NotionFailure };

async function loadCalls(cfg: ClientConfig): Promise<LoadResult> {
  try {
    return { ok: true, calls: await queryAllCalls(cfg.notion) };
  } catch (err) {
    if (err instanceof NotionError) {
      console.error(`Notion read failed (${err.failure.kind}):`, err.message);
      return { ok: false, failure: err.failure };
    }
    throw err;
  }
}

/**
 * Bookings never block the page.
 *
 * Notion holds the calls, which is what the dashboard is for; Calendly adds
 * the bookings behind them. If Calendly is not connected, or its token has
 * expired, everything still renders off the recordings alone — a broken
 * booking feed downgrades the show rate to the old one and says so, rather
 * than taking down a dashboard someone is using in a meeting.
 */
async function loadBookings(calls: CallRecord[], cfg: ClientConfig): Promise<CalendlyState> {
  if (!isCalendlyConfigured(cfg.calendly)) {
    return { link: null, windowStart: null, failure: null, pending: 0, total: 0, reading: false };
  }

  try {
    // Split from the matching below because the two fail slowly for completely
    // different reasons — one is Calendly over the wire, the other is CPU over
    // a few hundred bookings — and a single timer around both cannot say which.
    const result = await timed("calendly read", () => queryBookings(new Date(), cfg.calendly));
    const matchStarted = Date.now();
    const link = linkBookings(result.bookings, calls);
    const matchTook = Date.now() - matchStarted;
    if (matchTook >= SLOW_MS) {
      console.log(
        `[slow] calendly matching took ${matchTook}ms ` +
          `(${result.bookings.length} bookings against ${calls.length} calls)`
      );
    }
    return {
      link: result.reading ? null : link,
      windowStart: result.window_start,
      failure: null,
      pending: result.pending,
      total: result.total,
      reading: result.reading,
    };
  } catch (err) {
    if (err instanceof CalendlyError) {
      console.error(`Calendly read failed (${err.failure.kind}):`, err.message);
      return {
        link: null,
        windowStart: null,
        failure: err.failure,
        pending: 0,
        total: 0,
        reading: false,
      };
    }
    throw err;
  }
}

/**
 * Payments never block the page either, and for the same reason as bookings:
 * a refused Whop route downgrades the Cash Collected tile to the tracker's
 * own figure, it does not take the dashboard down.
 */
async function loadPayments(cfg: ClientConfig): Promise<WhopRead | null> {
  if (!isWhopConfigured(cfg.whop)) return null;
  try {
    return await queryPayments(cfg.whop);
  } catch (err) {
    console.error("Whop read failed:", err);
    return null;
  }
}

export default async function Home() {
  // Resolved once per request so the date filter agrees between the server
  // render and hydration — reading the clock in the client component instead
  // makes the two disagree across a midnight boundary or any clock skew.
  const today = new Date().toISOString().split("T")[0];

  // Preview the dashboard without Notion. Unset in any real deployment.
  if (process.env.DASHBOARD_DEMO_DATA === "1") {
    const { demoCalls, demoBookings, DEMO_CLIENTS } = await import("@/lib/demo-data");
    const calls = demoCalls(today);
    // WHOSE NAME GOES IN THE HEADER, read from the shared choice the bar
    // writes. Demo mode has no registry to resolve credentials against, so
    // every name here renders the same invented calls — but the header follows
    // the bar, which is what makes the loop reviewable locally: pick a client
    // on the KPI dashboard, and this page agrees when you walk over to it.
    const demoChosen = (await cookies()).get(VIEWING_COOKIE)?.value ?? null;
    const demoCurrent = DEMO_CLIENTS.find((c) => c.id === demoChosen) ?? null;
    // Bookings are part of the demo unless you ask to see the dashboard as it
    // looks before Calendly is connected — which is the state every new install
    // starts in, and therefore worth being able to preview on purpose.
    const link =
      process.env.DEMO_WITHOUT_CALENDLY === "1"
        ? null
        : linkBookings(demoBookings(calls, today), calls);
    return (
      <Dashboard
        calls={calls}
        today={today}
        calendly={{
          link,
          windowStart: null,
          failure: null,
          pending: 0,
          total: link?.bookings.length ?? 0,
          reading: false,
        }}
        brandName={demoCurrent?.name ?? "Funded Blueprint"}
        demo
      />
    );
  }

  // WHOSE DASHBOARD IS THIS. Resolved once per request and threaded down, so
  // every read below is unambiguously one client's -- rather than each library
  // reaching into the environment and all of them silently agreeing because
  // there has only ever been one client per deployment.
  const viewing = await timed("identity + credentials", () => currentViewing());

  // A pinned client that could not be opened. Nothing is read and nothing is
  // rendered — not the deployment's own calls under the pinned name, which is
  // what the old fallback-plus-banner did. See Viewing.config in client-config.
  if (!viewing.config) {
    return (
      <SwitchRefused
        message={
          viewing.switchError ??
          "The pinned client could not be opened, and the registry did not say why."
        }
      />
    );
  }
  const cfg: ClientConfig = viewing.config;

  /**
   * THE PAYMENTS READ STARTS HERE, NOT AFTER NOTION.
   *
   * It was sitting in the Promise.all below, which does not begin until the
   * whole Notion crawl has landed -- and Whop needs nothing from Notion. On
   * the cold figures recorded in live-cache.ts (Notion 0.84s, Whop 2.15s) that
   * was three seconds of waiting where the slower of the two, 2.15s, is the
   * real floor.
   *
   * Not awaited yet: the crawl runs while Notion is read, and the Promise.all
   * further down collects it. loadPayments swallows its own failures and
   * returns null, so this can never become an unhandled rejection on the early
   * return below -- which is the trap this shape usually sets.
   */
  const paymentsRead = timed("whop payments", () => loadPayments(cfg));

  const result = await timed("notion calls", () => loadCalls(cfg));

  if (!result.ok) return <SetupNotice failure={result.failure} />;

  // Rows that belong to another offer, dropped before anything else sees them.
  // A closer who sells two products books both into one tracker, so a row can
  // be filled in correctly and still not be this client's business. Doing it
  // here — ahead of bookings, reconciliation and settlement — is what stops an
  // excluded call being matched to a booking, or turned back into a win by a
  // payment. See excluded-calls.json for why it is a list and not a rule.
  const { kept, excluded } = partitionCalls(result.calls);
  if (excluded.length > 0) {
    console.log(
      `Excluded ${excluded.length} call(s) that belong to another offer: ` +
        excluded
          .map((e) => `${e.call.name || "Unknown"} (${e.call.call_date ?? "no date"})`)
          .join(", ")
    );
  }

  const [calendly, payments] = await Promise.all([
    loadBookings(kept, cfg),
    paymentsRead,
  ]);

  // Matched on the server: the buyer list holds addresses the client has no
  // reason to receive, and only the disagreements need to travel.
  //
  // ORDER MATTERS. reconcile runs on what the closers actually typed, so it can
  // still see and report the rows that disagree with the processor. settle then
  // counts those rows as the wins they turned out to be. Doing it the other way
  // round would settle the calls first and leave reconcile with nothing to
  // report — the disagreement would vanish from the page instead of being
  // named, and the Notion rows would never get corrected.
  const reconciliation = payments ? reconcile(kept, payments.buyers) : null;
  const calls = settle(kept, reconciliation);

  return (
    <Dashboard
      brandName={cfg.brandName}
      calls={calls}
      today={today}
      calendly={calendly}
      payments={payments?.days ?? null}
      reconciliation={reconciliation}
      excluded={excluded.map((e) => ({
        name: e.call.name || "Unknown",
        call_date: e.call.call_date,
        reason: e.entry.reason ?? "",
      }))}
    />
  );
}
