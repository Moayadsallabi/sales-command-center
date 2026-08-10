import { queryAllCalls, NotionError, NotionFailure } from "@/lib/notion";
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

export default async function Home() {
  const result = await loadCalls();

  if (!result.ok) return <SetupNotice failure={result.failure} />;

  // Resolved once per request so the date filter agrees between the server
  // render and hydration — reading the clock in the client component instead
  // makes the two disagree across a midnight boundary or any clock skew.
  const today = new Date().toISOString().split("T")[0];

  return <Dashboard calls={result.calls} today={today} />;
}
