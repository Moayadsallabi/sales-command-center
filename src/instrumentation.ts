/**
 * Filling the dashboard's cache before anybody asks for it.
 *
 * ---------------------------------------------------------------------------
 * THE MEASUREMENT THIS EXISTS FOR
 *
 * Timed against the live account on 2026-08-27, straight after a deploy:
 *
 *     load 1   20882ms
 *     load 2     285ms
 *     load 3     252ms
 *
 * The cache was working. It was just empty, and somebody had to be the one to
 * fill it — walking the whole Notion database, the whole Whop payment history
 * and Calendly's event list while they sat there. That somebody is whoever
 * opens the dashboard first after a restart, and a container restarts on every
 * deploy. "Fast unless you are the first to look" is not fast, and it is worse
 * than plain slowness because the person who hits it can never reproduce it.
 *
 * It is not only the first visit, either. live-cache stops serving a value
 * after ten minutes without a successful re-read, so on a dashboard somebody
 * opens twice a day, EVERY visit is the slow one.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ASKS ITSELF FOR THE PAGE RATHER THAN CALLING THE READERS
 *
 * The first version imported queryAllCalls, queryPayments and queryBookings and
 * called them here. It ran, it logged sensible times, and it warmed nothing:
 *
 *     [warm] calendly ready in 7748ms          <- this file's copy
 *     [calendly] event list crawled in 5442ms  <- the page, doing it again
 *
 * Next bundles instrumentation separately from the route, so a module's
 * top-level state — every one of these caches — exists TWICE. Filling the copy
 * in this bundle does nothing for the copy the render reads, and the only
 * reason we found out is that the crawl logs itself.
 *
 * So the warm-up asks the server for the page over HTTP, the same way a person
 * would. It costs one render nobody looks at, and in exchange the thing being
 * warmed is provably the thing being read — there is no second copy to get
 * this wrong again. It also absorbs the module loading Next does on a route's
 * first request, which the direct calls never could.
 *
 * Nothing here blocks the server coming up, and a failed warm is logged and
 * forgotten: a dashboard that will not start because Notion is having a bad
 * morning is a worse failure than a slow first load.
 */

/**
 * Often enough that nothing ages past the ten minutes after which live-cache
 * stops serving a value, with room for a slow read in between.
 */
const WARM_EVERY_MS = 4 * 60_000;

/** Long enough for the listener to be up. It is milliseconds, not a race. */
const FIRST_WARM_DELAY_MS = 1_500;

function selfUrl(): string {
  const port = process.env.PORT ?? "3000";
  // The loopback address rather than the public hostname: this must not leave
  // the container, go back out through the proxy, and count against whatever
  // rate limit sits in front of it.
  return `http://127.0.0.1:${port}/`;
}

/**
 * The dashboard's own credentials, so the warm request gets the page rather
 * than the sign-in prompt. Nothing new is exposed — the process already holds
 * these, and the request never leaves the container.
 */
function selfHeaders(): Record<string, string> {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) return {};
  const user = process.env.DASHBOARD_USER ?? "admin";
  return {
    Authorization: "Basic " + Buffer.from(`${user}:${password}`).toString("base64"),
  };
}

async function warmOnce(label: string): Promise<void> {
  const started = Date.now();
  try {
    const res = await fetch(selfUrl(), {
      headers: selfHeaders(),
      cache: "no-store",
    });
    // Read the body: the render is not finished until it has been streamed,
    // and a warm that stops at the headers would return before the reads it
    // exists to trigger have landed.
    await res.text();
    const took = Date.now() - started;
    // The first one is the interesting one; a routine top-up that took two
    // seconds is not worth a line every four minutes.
    if (label === "first" || took >= 2_000) {
      console.log(`[warm] ${label} pass: ${res.status} in ${took}ms`);
    }
  } catch (err) {
    console.error(`[warm] ${label} pass failed:`, err instanceof Error ? err.message : err);
  }
}

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Demo mode reads no API at all, so there is nothing to warm.
  if (process.env.DASHBOARD_DEMO_DATA === "1") return;

  // An escape hatch for anyone running this locally who does not want the
  // server fetching live accounts the moment it starts.
  if (process.env.DASHBOARD_NO_WARM === "1") return;

  setTimeout(() => void warmOnce("first"), FIRST_WARM_DELAY_MS).unref?.();

  const timer = setInterval(() => void warmOnce("keep-warm"), WARM_EVERY_MS);
  timer.unref?.();
}
