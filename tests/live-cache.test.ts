/**
 * The short memory that stops every render re-crawling Notion and Whop.
 *
 * The rule this module must never break: it may make a reader wait less, it
 * may NOT make a broken feed look like a working one. So the tests that matter
 * here are the failure ones — a first read that throws must cache nothing, and
 * a value must stop being served once refreshes have been failing long enough
 * for it to be a lie.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { accountKey, cachedRead, cacheSecondsFrom, resetCache } from "../src/lib/live-cache";

const WINDOW = { ttlMs: 60_000, maxStaleMs: 600_000 };

/** Lets the background refresh's promise chain settle. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

let now = 1_700_000_000_000;

beforeEach(() => {
  resetCache();
  now = 1_700_000_000_000;
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

function advance(ms: number) {
  now += ms;
  vi.setSystemTime(now);
}

describe("cachedRead", () => {
  it("reads once, then answers from memory inside the window", async () => {
    const load = vi.fn(async () => "first");

    expect(await cachedRead("k", load, WINDOW)).toBe("first");
    advance(30_000);
    expect(await cachedRead("k", load, WINDOW)).toBe("first");

    expect(load).toHaveBeenCalledTimes(1);
  });

  it("hands back the old value immediately and refreshes behind the reader", async () => {
    let value = "first";
    const load = vi.fn(async () => value);

    await cachedRead("k", load, WINDOW);
    value = "second";
    advance(61_000);

    // The point of the whole module: the reader that triggers the refresh is
    // NOT the one that waits for it. If this ever returns "second", the cache
    // has quietly gone back to blocking.
    expect(await cachedRead("k", load, WINDOW)).toBe("first");
    await settle();
    expect(await cachedRead("k", load, WINDOW)).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the last good value when a background refresh fails", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("good")
      .mockRejectedValue(new Error("Notion is down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    await cachedRead("k", load, WINDOW);
    advance(61_000);
    expect(await cachedRead("k", load, WINDOW)).toBe("good");
    await settle();
    expect(await cachedRead("k", load, WINDOW)).toBe("good");

    quiet.mockRestore();
  });

  it("stops serving the old value once refreshes have failed for maxStale", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("good")
      .mockRejectedValue(new Error("Notion is down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    await cachedRead("k", load, WINDOW);
    // Inside the stale window the figure still stands...
    advance(120_000);
    expect(await cachedRead("k", load, WINDOW)).toBe("good");
    await settle();

    // ...past it, the reader gets the real error rather than a figure from ten
    // minutes ago with nothing on screen saying so.
    advance(600_000);
    await expect(cachedRead("k", load, WINDOW)).rejects.toThrow("Notion is down");

    quiet.mockRestore();
  });

  it("caches nothing when the very first read fails", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("bad token"))
      .mockResolvedValue("recovered");

    await expect(cachedRead("k", load, WINDOW)).rejects.toThrow("bad token");
    // No entry was written, so the next reader genuinely retries rather than
    // being handed a cached failure.
    expect(await cachedRead("k", load, WINDOW)).toBe("recovered");
  });

  it("makes one read when several requests arrive at a cold start", async () => {
    let release: (v: string) => void = () => {};
    const load = vi.fn(() => new Promise<string>((r) => { release = r; }));

    const all = Promise.all([
      cachedRead("k", load, WINDOW),
      cachedRead("k", load, WINDOW),
      cachedRead("k", load, WINDOW),
    ]);
    release("once");

    expect(await all).toEqual(["once", "once", "once"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("never serves one account's answer to another", async () => {
    await cachedRead(accountKey("notion", "key-a", "db-a"), async () => "a's calls", WINDOW);
    const other = await cachedRead(
      accountKey("notion", "key-b", "db-b"),
      async () => "b's calls",
      WINDOW
    );
    expect(other).toBe("b's calls");
  });

  it("keys on the database as well as the token", () => {
    // One integration token granted two clients' trackers. Keyed on the token
    // alone these collide, and the symptom is one client's calls under the
    // other's name rather than an error.
    expect(accountKey("notion", "same-token", "db-a")).not.toBe(
      accountKey("notion", "same-token", "db-b")
    );
  });

  it("keeps the credential out of the key", () => {
    expect(accountKey("whop", "sk_live_supersecret")).not.toContain("supersecret");
  });
});

describe("cacheSecondsFrom", () => {
  it("takes a number from the environment and falls back on anything else", () => {
    process.env.TEST_CACHE_SECONDS = "15";
    expect(cacheSecondsFrom("TEST_CACHE_SECONDS", 60)).toBe(15);

    process.env.TEST_CACHE_SECONDS = "0";
    expect(cacheSecondsFrom("TEST_CACHE_SECONDS", 60)).toBe(0);

    process.env.TEST_CACHE_SECONDS = "nonsense";
    expect(cacheSecondsFrom("TEST_CACHE_SECONDS", 60)).toBe(60);

    delete process.env.TEST_CACHE_SECONDS;
    expect(cacheSecondsFrom("TEST_CACHE_SECONDS", 60)).toBe(60);
  });
});
