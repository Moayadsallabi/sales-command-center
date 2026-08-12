import { CallRecord } from "./types";
import { DIMENSIONS, DimensionKey } from "./dimensions";

/**
 * Deterministic sample calls, used when DASHBOARD_DEMO_DATA=1. Lets you see
 * the dashboard before the first real call lands, and gives the UI something
 * to render in development without Notion credentials.
 *
 * Never reached in normal operation — src/app/page.tsx only calls this when
 * the environment variable is set.
 */

const CLOSERS = ["Sam Rep", "Jordan Ellis", "Priya Nair"];
const NAMES = [
  "Alex Morgan", "Dana Silva", "Chris Okafor", "Robin Tan", "Casey Fields",
  "Morgan Reyes", "Jamie Cole", "Riley Novak", "Avery Lin", "Quinn Baptiste",
  "Drew Halvorsen", "Sasha Ibrahim", "Kai Petrov", "Noor Haddad", "Emerson Blake",
];
const NICHES = ["Trading education", "Fitness coaching", "Agency owner", "SaaS founder"];
const SOURCES = ["IG", "YouTube", "Referral", "Skool", "Direct"];

/** Small deterministic PRNG so the demo set is identical on every render. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function shiftDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

export function demoCalls(today: string): CallRecord[] {
  const rand = seeded(20260812);

  // Each closer has a deliberate weak dimension so the pattern detection and
  // the leaderboard's "weakest dimension" column have something real to find.
  const weakness: Record<string, DimensionKey> = {
    "Sam Rep": "tension_management",
    "Jordan Ellis": "discovery_depth",
    "Priya Nair": "objection_resolution",
  };

  return Array.from({ length: 42 }, (_, i) => {
    const closer = CLOSERS[i % CLOSERS.length];
    const roll = rand();
    const outcome =
      roll > 0.72 ? "Customer" : roll > 0.55 ? "BAMFAM" : roll > 0.18 ? "No deal" : "No show";
    const closed = outcome === "Customer";
    const tier = closed ? (rand() > 0.55 ? 2 : 1) : rand() > 0.5 ? 1 : null;
    const price = tier === 2 ? 9000 : 4500;
    const pif = rand() > 0.5;

    const scores = {} as Record<DimensionKey, number | null>;
    for (const dimension of DIMENSIONS) {
      const base = closed ? 7.4 : 5.9;
      const penalty = weakness[closer] === dimension.key ? 2.3 : 0;
      const score = Math.round(base + rand() * 2.2 - penalty);
      scores[dimension.key] = Math.min(10, Math.max(1, score));
    }

    const noShow = outcome === "No show";

    return {
      id: `demo-${String(i).padStart(4, "0")}-0000-4000-8000-00000000${String(i).padStart(4, "0")}`,
      name: NAMES[i % NAMES.length],
      closer,
      call_date: shiftDays(today, Math.floor(i * 1.7)),
      outcome,
      tier: tier ? `Tier ${tier}` : null,
      price_discussed: noShow ? null : price,
      price_closed: closed ? price : null,
      payment_structure: closed ? (pif ? "PIF" : "installments") : null,
      cash_collected: closed ? (pif ? price : Math.round(price / 2)) : null,
      prospect_revenue: `${20 + Math.floor(rand() * 60)}k/mo`,
      niche: NICHES[i % NICHES.length],
      location: "—",
      lead_source: SOURCES[i % SOURCES.length],
      quality_score: noShow
        ? null
        : Math.round(
            (DIMENSIONS.reduce((sum, d) => sum + (scores[d.key] ?? 0), 0) / DIMENSIONS.length) * 10
          ) / 10,
      duration: noShow ? 0 : 32 + Math.floor(rand() * 30),
      recording_url: "https://example.com/demo-recording",
      summary: `Sample call with ${NAMES[i % NAMES.length]}. This row is demo data, not a real call.`,
      scores: noShow
        ? (Object.fromEntries(DIMENSIONS.map((d) => [d.key, null])) as Record<
            DimensionKey,
            number | null
          >)
        : scores,
      flags: {
        value_leak: rand() > 0.75,
        follow_up_trap: outcome === "BAMFAM" && rand() > 0.4,
        early_price_drop: rand() > 0.7,
        weakest_belief: ["Money", "Trust", "Support", "Cost", "None"][Math.floor(rand() * 5)],
      },
      the_moment: noShow
        ? ""
        : "The prospect went quiet after the price. The caller filled the silence with a payment-plan offer before finding out whether they were sold.",
      next_call_drill: noShow
        ? ""
        : "After you say the number, count to five before you speak again. If they have not spoken by five, keep waiting.",
      notion_url: "https://www.notion.so/",
    } satisfies CallRecord;
  });
}
