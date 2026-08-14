import { CallRecord } from "./types";
import { DIMENSIONS, DimensionKey } from "./dimensions";

/**
 * Deterministic sample calls, used when DASHBOARD_DEMO_DATA=1. Lets you see
 * the dashboard before the first real call lands, and gives the UI something
 * to render in development without Notion credentials.
 *
 * The shape of this data is deliberate rather than random. Outcomes are
 * derived from the scores, so the "what each part of the call is worth" panel
 * shows a real close-rate gap instead of noise. Each closer has a planted
 * weakness, one of them is improving, and every closer is weak on the same
 * dimension so the team-versus-individual split has something to find.
 *
 * Never reached in normal operation — src/app/page.tsx only calls this when
 * the environment variable is set.
 */

const CLOSERS = ["Sam Rep", "Jordan Ellis", "Priya Nair"] as const;
type Closer = (typeof CLOSERS)[number];

const NAMES = [
  "Alex Morgan", "Dana Silva", "Chris Okafor", "Robin Tan", "Casey Fields",
  "Morgan Reyes", "Jamie Cole", "Riley Novak", "Avery Lin", "Quinn Baptiste",
  "Drew Halvorsen", "Sasha Ibrahim", "Kai Petrov", "Noor Haddad", "Emerson Blake",
  "Frankie Dorsey", "Marlowe Chen", "Indigo Park", "Rowan Adeyemi", "Sky Vasquez",
];
const NICHES = ["Trading education", "Fitness coaching", "Agency owner", "SaaS founder"];
const SOURCES = ["IG", "YouTube", "Referral", "Skool", "Direct"];

/**
 * Each closer's own weak spot, and which way they are moving. `drift` lifts or
 * drops their whole game over time, so the trend column has something to show;
 * `weakDrift` moves the weak spot specifically.
 */
const WEAKNESS: Record<
  Closer,
  { key: DimensionKey; drift: number; weakDrift: number }
> = {
  // Was coached on holding silence, and it took — recent calls are better.
  "Sam Rep": { key: "tension_management", drift: 3.0, weakDrift: 4.5 },
  "Jordan Ellis": { key: "discovery_depth", drift: 0, weakDrift: 0 },
  // Sliding. Worth catching before it costs another quarter.
  "Priya Nair": { key: "objection_resolution", drift: -2.4, weakDrift: -2.0 },
};

/** Everyone is weak here, which should read as a script problem, not a person. */
const TEAM_WEAKNESS: DimensionKey = "belief_architecture";

/**
 * Written feedback per dimension, so the demo's moment and drill match the
 * scores on the same call. Real reviews come from the transcript; hardcoding
 * one story for every call made the demo contradict itself.
 */
const FEEDBACK: Record<DimensionKey, { moment: string; drill: string }> = {
  frame_ownership: {
    moment:
      "Eight minutes in the prospect asked what it costs, and the caller answered. From there the prospect was interviewing the caller rather than the other way round.",
    drill:
      "When they ask the price early, say: 'I'll give you the number, but it won't mean anything until I know what you're dealing with.' Then go straight back to your question.",
  },
  discovery_depth: {
    moment:
      "The prospect said 'we just need more leads' and the caller moved on. Nobody ever found out how many leads, worth what, or why the last attempt failed.",
    drill:
      "Every time you get a one-line answer, ask 'how do you mean?' once before you move on. Once, every time, no exceptions.",
  },
  belief_architecture: {
    moment:
      "The caller pitched before the prospect had said out loud what the problem was costing them. The price then landed against nothing.",
    drill:
      "Before you pitch, get them to say the cost of doing nothing in their own words. If you haven't heard a number or a consequence from their mouth, you're not ready to pitch.",
  },
  pitch_precision: {
    moment:
      "The pitch was the standard walkthrough. Nothing the prospect said in the previous twenty minutes appeared in it.",
    drill:
      "Write down three phrases the prospect uses during discovery. Use all three, word for word, when you pitch.",
  },
  tension_management: {
    moment:
      "The prospect went quiet after the price. The caller filled the silence with a payment plan before finding out whether they were sold.",
    drill:
      "After you say the number, count to five before you speak again. If they haven't spoken by five, keep waiting.",
  },
  objection_resolution: {
    moment:
      "'I need to think about it' got answered with a discount. The caller never found out what they actually needed to think about.",
    drill:
      "When you hear an objection, say 'that's fair' and then ask what specifically they'd want to be sure of. Answer nothing until they've told you.",
  },
  qualification: {
    moment:
      "The prospect mentioned a business partner in the first five minutes. It came back at the close as the reason they couldn't decide.",
    drill:
      "In the first five minutes ask: 'is this your call alone, or is someone else in it with you?' If someone else is, get them on the next call before you pitch.",
  },
  strategic_awareness: {
    moment:
      "The prospect was ready to buy around the twenty-minute mark. The caller kept going with the full presentation and the energy drained out of it.",
    drill:
      "When they ask how to get started, stop presenting and start closing. Don't finish the deck out of habit.",
  },
};

const STRONG_CALL = {
  moment:
    "The caller held silence for nine seconds after the price. The prospect filled it themselves and talked their own way into the deal.",
  drill:
    "Nothing to fix here. Save this recording and use the price moment as the example when you train someone new.",
};

const CALL_COUNT = 96;
const DAYS_APART = 1.35;

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

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function demoCalls(today: string): CallRecord[] {
  const rand = seeded(20260812);
  const calls: CallRecord[] = [];

  for (let i = 0; i < CALL_COUNT; i++) {
    const closer = CLOSERS[i % CLOSERS.length];
    const daysAgo = Math.floor(i * DAYS_APART);

    // 0 for the oldest call, 1 for the newest. Drives the improving closer.
    const recency = 1 - daysAgo / (CALL_COUNT * DAYS_APART);

    // A tenth of calls are no-shows, which never get scored.
    if (rand() < 0.1) {
      calls.push(
        buildCall({
          i, closer, daysAgo, today, rand,
          outcome: "No show",
          scores: Object.fromEntries(DIMENSIONS.map((d) => [d.key, null])) as Record<
            DimensionKey,
            number | null
          >,
        })
      );
      continue;
    }

    const { key: weakKey, drift, weakDrift } = WEAKNESS[closer];
    // `recency - 0.5` so the drift is symmetrical: the oldest calls sit as far
    // below the closer's baseline as the newest sit above it.
    const baseline = 6.6 + rand() * 1.6 + drift * (recency - 0.5);

    const scores = {} as Record<DimensionKey, number | null>;
    for (const dimension of DIMENSIONS) {
      let value = baseline + (rand() - 0.5) * 1.4;
      if (dimension.key === weakKey) {
        // The planted weakness, easing or worsening over time.
        value -= 2.8 - weakDrift * (recency - 0.5);
      }
      if (dimension.key === TEAM_WEAKNESS) value -= 1.5;
      scores[dimension.key] = Math.round(clamp(value, 1, 10));
    }

    const average =
      DIMENSIONS.reduce((sum, d) => sum + (scores[d.key] as number), 0) / DIMENSIONS.length;

    // Outcome follows the score, which is the whole premise the dashboard is
    // meant to demonstrate. Not perfectly — a good call still loses sometimes.
    const chanceOfClosing = clamp((average - 4.2) / 5.5, 0.05, 0.85);
    const roll = rand();
    const outcome =
      roll < chanceOfClosing
        ? "Customer"
        : roll < chanceOfClosing + 0.25
        ? "BAMFAM"
        : "No deal";

    calls.push({ ...buildCall({ i, closer, daysAgo, today, rand, outcome, scores }) });
  }

  return calls;
}

function buildCall({
  i,
  closer,
  daysAgo,
  today,
  rand,
  outcome,
  scores,
}: {
  i: number;
  closer: string;
  daysAgo: number;
  today: string;
  rand: () => number;
  outcome: string;
  scores: Record<DimensionKey, number | null>;
}): CallRecord {
  const closed = outcome === "Customer";
  const noShow = outcome === "No show";
  const tier = closed ? (rand() > 0.55 ? 2 : 1) : rand() > 0.5 ? 1 : null;
  const price = tier === 2 ? 9000 : 4500;
  const pif = rand() > 0.5;
  const scored = DIMENSIONS.map((d) => scores[d.key]).filter(
    (v): v is number => v != null
  );

  // The written feedback follows the weakest dimension on this call, so the
  // narrative and the scores never contradict each other.
  const weakest = DIMENSIONS.map((d) => ({ key: d.key, score: scores[d.key] }))
    .filter((e): e is { key: DimensionKey; score: number } => e.score != null)
    .sort((a, b) => a.score - b.score)[0];
  const feedback =
    weakest == null
      ? null
      : weakest.score >= 7
      ? STRONG_CALL
      : FEEDBACK[weakest.key];
  const low = (key: DimensionKey) => (scores[key] ?? 10) < 7;

  return {
    id: `demo-${String(i).padStart(4, "0")}-0000-4000-8000-00000000${String(i).padStart(4, "0")}`,
    name: NAMES[i % NAMES.length],
    closer,
    call_date: shiftDays(today, daysAgo),
    outcome,
    tier: tier ? `Tier ${tier}` : null,
    price_discussed: noShow ? null : price,
    price_closed: closed ? price : null,
    payment_structure: closed ? (pif ? "PIF" : "installments") : null,
    collected_on_call: closed ? (pif ? price : Math.round(price / 2)) : null,
    // Instalment deals show the rest landing after the call, so the sample data
    // exercises the on-the-call / collected-to-date split rather than hiding it.
    cash_collected: closed && !pif ? Math.round(price * 0.75) : null,
    outstanding: closed && !pif ? price - Math.round(price * 0.75) : null,
    // Every fourth deal is priced in euros, so the demo proves the conversion
    // path works instead of only ever exercising the reporting currency.
    currency: closed && i % 4 === 0 ? "EUR" : "USD",
    // One euro deal is left without a rate on purpose, so the demo also shows
    // the warning that fires when a foreign-currency row would be counted 1:1.
    fx_rate: closed && i % 4 === 0 ? (i % 8 === 0 ? null : 1.085) : null,
    prospect_revenue: `${20 + Math.floor(rand() * 60)}k/mo`,
    niche: NICHES[i % NICHES.length],
    location: "—",
    lead_source: SOURCES[i % SOURCES.length],
    quality_score:
      scored.length === 0
        ? null
        : Math.round((scored.reduce((s, v) => s + v, 0) / scored.length) * 10) / 10,
    duration: noShow ? 0 : 32 + Math.floor(rand() * 30),
    recording_url: "https://example.com/demo-recording",
    summary: `Sample call with ${NAMES[i % NAMES.length]}. This row is demo data, not a real call.`,
    scores,
    flags: {
      // Each flag only fires when the score it relates to actually dropped.
      value_leak: low("frame_ownership") && rand() > 0.4,
      follow_up_trap: outcome === "BAMFAM" && low("objection_resolution"),
      early_price_drop: low("tension_management") && rand() > 0.3,
      weakest_belief: noShow
        ? null
        : low("belief_architecture")
        ? ["Money", "Trust", "Support", "Cost"][Math.floor(rand() * 4)]
        : "None",
    },
    the_moment: feedback?.moment ?? "",
    next_call_drill: feedback?.drill ?? "",
    notion_url: "https://www.notion.so/",
  };
}
