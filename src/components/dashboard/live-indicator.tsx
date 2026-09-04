"use client";

import { useEffect, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";

const REFRESH_MS = 60_000;

const noopSubscribe = () => () => {};

/** False while server-rendering and during hydration, true afterwards. */
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

function ago(seconds: number): string {
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

/**
 * Re-runs the page's server component on an interval so the dashboard picks up
 * new Notion rows without a full reload. `page.tsx` is force-dynamic and the
 * Notion fetch is no-store, so a refresh always hits the API.
 */
export function LiveIndicator() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const mounted = useMounted();
  // `isPending` is not false during SSR, so reading it before mount makes the
  // server and client render different labels and hydration fails.
  const syncing = mounted && isPending;
  // Seconds since the data was last fetched. Counted rather than derived from
  // a timestamp so there is no clock reading during render to desync on
  // hydration — the server just rendered, so mounting at 0 is accurate.
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    function refresh() {
      // A background tab doesn't need fresh data; it refreshes on focus below.
      if (document.visibilityState !== "visible") return;
      startTransition(() => {
        router.refresh();
        setElapsed(0);
      });
    }

    const interval = setInterval(refresh, REFRESH_MS);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div
        className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
          syncing ? "bg-gold-300 animate-pulse" : "bg-gold-500"
        }`}
      />
      {/* Never wraps. "54S AGO" breaking across two lines was pushing the
          header a row taller on a phone for a label nobody reads twice. */}
      <span
        className="whitespace-nowrap text-[11px] tabular-nums text-zinc-400"
        title="Auto-refreshes every 60 seconds"
      >
        {syncing ? "SYNCING" : ago(elapsed).toUpperCase()}
      </span>
    </div>
  );
}
