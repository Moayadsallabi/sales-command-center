/**
 * Filling the dashboard's cache before anybody asks for it.
 *
 * ---------------------------------------------------------------------------
 * THE MEASUREMENT THIS EXISTS FOR
 *
 * Timed against the live dashboard on 2026-08-27, straight after a deploy:
 *
 *     load 1   20882ms
 *     load 2     285ms
 *     load 3     252ms
 *
 * The cache was working perfectly. It was just empty, and somebody had to be
 * the one to fill it — walking the whole Notion database, the whole Whop
 * payment history and Calendly's event list while they sat there.
 *
 * That somebody is whoever opens the dashboard first after a restart, and a
 * container restarts on every deploy. On a day with three deploys, three
 * people wait twenty seconds and everybody else thinks the dashboard is fine.
 * "Fast unless you are the first to look" is not fast, and it is worse than
 * plain slowness because it is unreproducible — the person reporting it can
 * never show you.
 *
 * So the server does the waiting instead, at startup and then on a timer, and
 * the first human to arrive finds the figures already in hand.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT CAN AND CANNOT WARM AT STARTUP
 *
 * Only what this deployment holds in its own variables. A per-client
 * deployment (scc-brey) holds all three, so it warms completely. The
 * multi-client one holds Notion and reads the rest from the registry per
 * client, so startup warms Notion and the rest fills on the first visit for
 * that client — after which keepWarm keeps it filled, because it re-reads
 * whatever the cache has already seen rather than a fixed list.
 *
 * Nothing here blocks the server coming up. A dashboard that will not start
 * because Notion is having a bad morning is a worse failure than a slow first
 * load, so every one of these is started and none is waited on.
 */

const WARM_EVERY_MS = 5 * 60_000;

/**
 * How old an entry may get before the timer re-reads it. Comfortably under the
 * ten minutes after which live-cache stops serving a value at all, so an entry
 * never ages into the state where a visitor has to wait for it.
 */
const WARM_WHEN_OLDER_THAN_MS = 4 * 60_000;

export async function register(): Promise<void> {
  // The edge runtime has no business doing this, and importing the readers
  // there would fail — they use node:crypto.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Demo mode reads no API at all; warming it would fetch nothing and log a
  // confusing failure.
  if (process.env.DASHBOARD_DEMO_DATA === "1") return;

  const { configFromEnvironment } = await import("./lib/client-config");
  const { queryAllCalls } = await import("./lib/notion");
  const { queryBookings, isCalendlyConfigured } = await import("./lib/calendly");
  const { queryPayments, isWhopConfigured } = await import("./lib/whop");
  const { keepWarm } = await import("./lib/live-cache");

  const cfg = configFromEnvironment();

  function warm(name: string, read: () => Promise<unknown>) {
    const started = Date.now();
    read().then(
      () => console.log(`[warm] ${name} ready in ${Date.now() - started}ms`),
      (err) => console.error(`[warm] ${name} failed:`, err instanceof Error ? err.message : err)
    );
  }

  if (cfg.notion.apiKey && cfg.notion.databaseId) {
    warm("notion", () => queryAllCalls(cfg.notion));
  }
  if (isWhopConfigured(cfg.whop)) {
    warm("whop", () => queryPayments(cfg.whop));
  }
  if (isCalendlyConfigured(cfg.calendly)) {
    // Calendly returns as soon as it has the event list and fills the invitees
    // behind itself, so warming it early also means that backfill is finished
    // rather than starting when the first person opens the page.
    warm("calendly", () => queryBookings(new Date(), cfg.calendly));
  }

  const timer = setInterval(() => {
    void keepWarm(WARM_WHEN_OLDER_THAN_MS).catch((err) =>
      console.error("[warm] keep-warm pass failed:", err)
    );
  }, WARM_EVERY_MS);
  // Nothing should be held open by this alone.
  timer.unref?.();
}
