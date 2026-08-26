import { queryAllCalls, NotionError, NotionFailure } from "@/lib/notion";
import { queryBookings, isCalendlyConfigured, CalendlyError } from "@/lib/calendly";
import { queryPayments, isWhopConfigured, WhopRead } from "@/lib/whop";
import { linkBookings, CalendlyState } from "@/lib/bookings";
import { CallRecord } from "@/lib/types";
import { reconcile } from "@/lib/reconcile";
import { partitionCalls } from "@/lib/excluded-calls";
import { settle } from "@/lib/settle";
import { Dashboard } from "@/components/dashboard/dashboard";
import { headers } from "next/headers";
import {
  ClientConfig,
  VIEWING_COOKIE,
  configFromEnvironment,
  resolveViewing,
} from "@/lib/client-config";
import { cookies } from "next/headers";
import { SetupNotice } from "@/components/dashboard/setup-notice";

export const dynamic = "force-dynamic";

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
    return { link: null, windowStart: null, failure: null, pending: 0, total: 0 };
  }

  try {
    const result = await queryBookings(new Date(), cfg.calendly);
    return {
      link: linkBookings(result.bookings, calls),
      windowStart: result.window_start,
      failure: null,
      pending: result.pending,
      total: result.total,
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
    // The switcher, driven by the same cookie and the same route as the real
    // one. The names are invented and every one of them renders the same
    // invented calls — demo mode reads no registry and no tracker, so switching
    // here changes the label and nothing else. It exists so the control can be
    // used and reviewed without pointing a live dashboard at a live client.
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
        }}
        brandName={demoCurrent?.name ?? "Funded Blueprint"}
        clients={DEMO_CLIENTS}
        chosenClient={demoCurrent?.id ?? null}
        homeName="Funded Blueprint"
        demo
      />
    );
  }

  // WHOSE DASHBOARD IS THIS. Resolved once per request and threaded down, so
  // every read below is unambiguously one client's -- rather than each library
  // reaching into the environment and all of them silently agreeing because
  // there has only ever been one client per deployment.
  const cookieHeader = (await headers()).get("cookie");
  const viewing = await resolveViewing(
    cookieHeader,
    (await cookies()).get(VIEWING_COOKIE)?.value ?? null
  );
  const cfg: ClientConfig = viewing.config;

  const result = await loadCalls(cfg);

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
    loadPayments(cfg),
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
      clients={viewing.clients}
      chosenClient={viewing.chosen}
      homeName={configFromEnvironment().brandName}
      switchError={viewing.switchError}
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
