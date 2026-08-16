import { queryAllCalls, NotionError, NotionFailure } from "@/lib/notion";
import { queryBookings, isCalendlyConfigured, CalendlyError } from "@/lib/calendly";
import { linkBookings, CalendlyState } from "@/lib/bookings";
import { CallRecord } from "@/lib/types";
import { Dashboard } from "@/components/dashboard/dashboard";
import { SetupNotice } from "@/components/dashboard/setup-notice";

export const dynamic = "force-dynamic";

type LoadResult =
  | { ok: true; calls: CallRecord[] }
  | { ok: false; failure: NotionFailure };

async function loadCalls(): Promise<LoadResult> {
  try {
    return { ok: true, calls: await queryAllCalls() };
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
async function loadBookings(calls: CallRecord[]): Promise<CalendlyState> {
  if (!isCalendlyConfigured()) {
    return { link: null, windowStart: null, failure: null };
  }

  try {
    const result = await queryBookings();
    return {
      link: linkBookings(result.bookings, calls),
      windowStart: result.window_start,
      failure: null,
    };
  } catch (err) {
    if (err instanceof CalendlyError) {
      console.error(`Calendly read failed (${err.failure.kind}):`, err.message);
      return { link: null, windowStart: null, failure: err.failure };
    }
    throw err;
  }
}

export default async function Home() {
  // Resolved once per request so the date filter agrees between the server
  // render and hydration — reading the clock in the client component instead
  // makes the two disagree across a midnight boundary or any clock skew.
  const today = new Date().toISOString().split("T")[0];

  // Preview the dashboard without Notion. Unset in any real deployment.
  if (process.env.DASHBOARD_DEMO_DATA === "1") {
    const { demoCalls, demoBookings } = await import("@/lib/demo-data");
    const calls = demoCalls(today);
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
        calendly={{ link, windowStart: null, failure: null }}
        demo
      />
    );
  }

  const result = await loadCalls();

  if (!result.ok) return <SetupNotice failure={result.failure} />;

  const calendly = await loadBookings(result.calls);

  return <Dashboard calls={result.calls} today={today} calendly={calendly} />;
}
