/**
 * A short in-process memory for a slow upstream read.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 *
 * page.tsx is force-dynamic, so every render re-read every source from
 * scratch: Notion's whole call database, then Whop's whole payment history.
 * Measured against the live accounts on 2026-08-27 that was 0.84s for Notion
 * and 2.15s for Whop, and both grow with the business — Whop pages 50 payments
 * at a time and was already on its third page. Nothing was sent to the browser
 * until all of it had landed, and the dashboard re-runs its own server render
 * every sixty seconds AND every time the tab is focused, so walking back to an
 * open tab paid the full three seconds again.
 *
 * None of that waiting bought anything. The numbers only move when a closer
 * fills in a row or a payment lands, and the page was already content to be up
 * to a minute behind — that is what its own refresh interval means.
 *
 * So: hand back what is in hand, and fetch the update behind the reader. This
 * is the same shape calendly.ts already uses for its event list; that file is
 * the reason the Calendly read was the only one of the three that was not
 * costing seconds.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * **It never caches a failure.** A first read that throws stores nothing and
 * throws on through, so a bad token still renders the setup notice rather than
 * an empty dashboard.
 *
 * **It stops serving stale data eventually.** If refreshes keep failing, the
 * value is served for `maxStaleMs` and no longer — after that the next reader
 * waits for a real read and sees the real error. A dashboard that quietly
 * shows figures from an hour ago, because the feed behind it died and nothing
 * said so, is the failure this whole codebase keeps being bitten by.
 *
 * **The key must name the account.** Two clients whose reads happen to look
 * alike must never share an entry: the symptom is not an error, it is one
 * client's calls rendered under another client's name. Callers build the key
 * with accountKey() below, which hashes the credential rather than storing it —
 * a cache key ends up in logs, and an API token has no business there.
 */
import { createHash } from "crypto";

type Entry<T> = {
  value: T;
  /** When `value` was read. */
  at: number;
  /** A refresh already running behind a reader; only ever one per key. */
  refreshing: boolean;
};

const entries = new Map<string, Entry<unknown>>();

/**
 * First reads in flight, so a cold start hit by three requests at once makes
 * one crawl rather than three. Cleared as soon as the read settles — failures
 * included, so the next reader retries rather than joining a dead promise.
 */
const firstReads = new Map<string, Promise<unknown>>();

export type CacheWindow = {
  /** How long a value is handed back with no refresh started behind it. */
  ttlMs: number;
  /** How long a value may keep being handed back while refreshes keep failing. */
  maxStaleMs: number;
};

/**
 * A stable, secret-free cache key for one account's read.
 *
 * `label` names the source ("notion", "whop"); everything after it is hashed.
 */
export function accountKey(label: string, ...secrets: (string | null | undefined)[]): string {
  const digest = createHash("sha256").update(secrets.map((s) => s ?? "").join("|")).digest("hex");
  return `${label}|${digest.slice(0, 16)}`;
}

/**
 * Reads through the cache: fresh value straight back, stale value straight
 * back with a refresh started behind it, nothing cached means waiting once.
 */
export async function cachedRead<T>(
  key: string,
  load: () => Promise<T>,
  window: CacheWindow
): Promise<T> {
  const entry = entries.get(key) as Entry<T> | undefined;

  if (!entry) {
    const inFlight = firstReads.get(key) as Promise<T> | undefined;
    if (inFlight) return inFlight;

    const read = load()
      .then((value) => {
        entries.set(key, { value, at: Date.now(), refreshing: false });
        return value;
      })
      .finally(() => {
        firstReads.delete(key);
      });
    firstReads.set(key, read);
    return read;
  }

  const age = Date.now() - entry.at;
  if (age < window.ttlMs) return entry.value;

  // Too old to keep standing behind. Wait for a real read, and let its error
  // reach the page if it has one.
  if (age >= window.maxStaleMs) {
    const value = await load();
    entry.value = value;
    entry.at = Date.now();
    entry.refreshing = false;
    return value;
  }

  if (!entry.refreshing) {
    entry.refreshing = true;
    void load()
      .then((value) => {
        entry.value = value;
        entry.at = Date.now();
      })
      .catch((err) => {
        // The last good value stands, and stops standing at maxStaleMs.
        console.error(`[cache] background refresh of ${key} failed:`, err);
      })
      .finally(() => {
        entry.refreshing = false;
      });
  }

  return entry.value;
}

/** Seconds from an env var, falling back when it is unset or nonsense. */
export function cacheSecondsFrom(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/** Tests only — module state outlives a test file otherwise. */
export function resetCache(): void {
  entries.clear();
  firstReads.clear();
}
