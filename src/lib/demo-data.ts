import { CallRecord } from "./types";
import { BookingRecord } from "./calendly";
import { DIMENSIONS, DimensionKey } from "./dimensions";
import { LEAD_FACTORS, LeadFactorKey } from "./lead-quality";

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
 * How good a lead each closer tends to be handed, as a shift on the 0–1 scale
 * the factors are drawn from. Jordan's execution is flat and unremarkable, so
 * a poor close rate on his calls has no explanation in the dimension scores at
 * all — it only shows up once the leads are scored too. That pairing is the
 * whole reason both halves exist, so the sample data has to contain a case of
 * it or the panels demonstrate nothing.
 */
const LEAD_BIAS: Record<Closer, number> = {
  "Sam Rep": 0.02,
  "Jordan Ellis": -0.2,
  "Priya Nair": 0.05,
};

/**
 * The objection a weak lead factor tends to surface as. Real objections come
 * from the transcript; this mapping exists so the demo's objection panel agrees
 * with its own lead scores instead of contradicting them.
 */
const OBJECTION_FOR: Record<LeadFactorKey, string> = {
  financial_capacity: "Price",
  urgency: "Timing",
  authority: "Partner",
  solution_belief: "Doubts the method",
  self_efficacy: "Doubts themselves",
  pain_severity: "Think about it",
  desire_clarity: "Think about it",
  icp_fit: "Comparing options",
};

const LEAD_READ: Record<LeadFactorKey, string> = {
  financial_capacity:
    "Wants it and cannot obviously afford it. The temptation is a payment plan; the fix is confirming capacity before the number, not after.",
  urgency:
    "A real buyer on the wrong day. Nothing is forcing this, so it will defer politely. Give it a deadline or book the return properly.",
  authority:
    "There is someone else in this decision who has not been in the room. Get them named early or the close happens without them and unwinds afterwards.",
  solution_belief:
    "Not convinced the approach works. Proof before price — anything else is arguing with someone who has not agreed the premise.",
  self_efficacy:
    "Believes the method and doubts themselves. Coachable, but it needs an identity reframe before the number, not a discount after it.",
  pain_severity:
    "Mildly dissatisfied rather than hurting. Discovery has to find the cost of staying put or there is nothing for the price to land against.",
  desire_clarity:
    "Cannot say what they actually want, which means they will not recognise it being offered. Make them name the outcome first.",
  icp_fit:
    "Adjacent to the buyer this offer is built for. Worth asking whether the targeting is right before asking what the closer did wrong.",
};

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

/**
 * A stable address per call index. It is the key the demo bookings join on, so
 * it has to be derived the same way from both sides rather than stored twice.
 * The names repeat every twenty calls, so the index goes in the address —
 * otherwise the same person would appear to book ninety-six times.
 */
function demoEmail(i: number): string {
  const slug = NAMES[i % NAMES.length].toLowerCase().replace(/[^a-z]+/g, ".");
  return `${slug}.${i}@example.com`;
}

export function demoCalls(today: string): CallRecord[] {
  const rand = seeded(20260812);
  const calls: CallRecord[] = [];

  for (let i = 0; i < CALL_COUNT; i++) {
    const closer = CLOSERS[i % CLOSERS.length];
    const daysAgo = Math.floor(i * DAYS_APART);

    // 0 for the oldest call, 1 for the newest. Drives the improving closer.
    const recency = 1 - daysAgo / (CALL_COUNT * DAYS_APART);

    // A tenth of calls are no-shows, which never get scored — and a prospect
    // who never turned up cannot be assessed as a lead either.
    if (rand() < 0.1) {
      calls.push(
        buildCall({
          i, closer, daysAgo, today, rand,
          outcome: "No show",
          scores: Object.fromEntries(DIMENSIONS.map((d) => [d.key, null])) as Record<
            DimensionKey,
            number | null
          >,
          lead: Object.fromEntries(LEAD_FACTORS.map((f) => [f.key, null])) as Record<
            LeadFactorKey,
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

    // How good this lead was, on 0–1, drawn independently of how the call was
    // run. Independence is the point: if lead quality tracked the dimension
    // scores, the dashboard could never separate the two and the panel that
    // splits them would be showing an artefact of the generator.
    const leadStrength = clamp(0.55 + (rand() - 0.5) * 0.62 + LEAD_BIAS[closer], 0.08, 0.97);

    const lead = {} as Record<LeadFactorKey, number | null>;
    for (const factor of LEAD_FACTORS) {
      // A fifth of the time the subject never came up, which leaves the factor
      // unscored — the case the normalised total has to survive.
      if (rand() < 0.2) {
        lead[factor.key] = null;
        continue;
      }
      const spread = leadStrength + (rand() - 0.5) * 0.26;
      lead[factor.key] = Math.round(clamp(factor.max * spread, 1, factor.max));
    }

    // Outcome follows both halves, roughly evenly. That is the premise the
    // dashboard is meant to demonstrate: a good call on a bad lead and a bad
    // call on a good lead both lose, and they are not the same problem.
    const execution = clamp((average - 4.2) / 5.5, 0, 1);
    const chanceOfClosing = clamp(execution * 0.55 + leadStrength * 0.45 - 0.1, 0.04, 0.86);
    const roll = rand();
    const outcome =
      roll < chanceOfClosing
        ? "Customer"
        : roll < chanceOfClosing + 0.25
        ? "BAMFAM"
        : "No deal";

    calls.push({ ...buildCall({ i, closer, daysAgo, today, rand, outcome, scores, lead }) });
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
  lead,
}: {
  i: number;
  closer: string;
  daysAgo: number;
  today: string;
  rand: () => number;
  outcome: string;
  scores: Record<DimensionKey, number | null>;
  lead: Record<LeadFactorKey, number | null>;
}): CallRecord {
  const closed = outcome === "Customer";
  const noShow = outcome === "No show";
  // Two deal sizes, so the money panels have a spread to show. This used to
  // be a tier, which the tracker no longer records.
  const price = rand() > 0.55 ? 9000 : 4500;
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

  // The lead factors, weakest share of its own ceiling first, so the objections
  // and the written read both follow from what was actually thin about the lead.
  const leadRanked = LEAD_FACTORS.filter((f) => lead[f.key] != null).sort(
    (a, b) => (lead[a.key] as number) / a.max - (lead[b.key] as number) / b.max
  );
  const weakestLead = leadRanked[0] ?? null;

  // A closed call may still have raised something on the way; a lost one raised
  // whatever its weakest factor points at, and sometimes the next one down too.
  const objections: string[] = [];
  if (!noShow && weakestLead) {
    const weakShare = (lead[weakestLead.key] as number) / weakestLead.max;
    if (!closed || rand() > 0.55) objections.push(OBJECTION_FOR[weakestLead.key]);
    const second = leadRanked[1];
    if (second && !closed && weakShare < 0.6 && rand() > 0.5) {
      const next = OBJECTION_FOR[second.key];
      if (!objections.includes(next)) objections.push(next);
    }
  }

  // A stable minute-and-second mark per call, so the timestamp links in the
  // written feedback have something to point at in demo mode.
  const stampSeconds = 240 + (i * 137) % 1500;
  const stamp = `${String(Math.floor(stampSeconds / 60)).padStart(2, "0")}:${String(
    stampSeconds % 60
  ).padStart(2, "0")}`;

  return {
    id: `demo-${String(i).padStart(4, "0")}-0000-4000-8000-00000000${String(i).padStart(4, "0")}`,
    name: NAMES[i % NAMES.length],
    prospect_email: demoEmail(i),
    closer,
    call_date: shiftDays(today, daysAgo),
    outcome,
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
    lead,
    lead_read: weakestLead ? LEAD_READ[weakestLead.key] : "",
    objections,
    // The one that decided it. A call that closed was not decided by an
    // objection, so it has none even when one was raised along the way.
    primary_objection: closed || objections.length === 0 ? null : objections[0],
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
    the_moment: feedback ? `${feedback.moment} [${stamp}]` : "",
    next_call_drill: feedback?.drill ?? "",
    offer_match: "this offer",
    offer_evidence: "",
    notion_url: "https://www.notion.so/",
  };
}

/* --------------------------------------------------------- demo bookings */

const BOOKING_QUESTIONS = [
  "What are you currently making per month?",
  "What have you already tried?",
  "How soon are you looking to start?",
];
const BOOKING_ANSWERS = [
  ["$18k/mo", "$40k/mo", "$7k/mo", "Just under $30k"],
  ["Ran ads myself, no system behind them", "Two agencies, neither retained", "Nothing yet"],
  ["This month", "Next quarter", "As soon as it makes sense"],
];

/** An ISO timestamp `daysAgo` before `today`, at a stable hour per index. */
function bookingTime(today: string, daysAgo: number, i: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(13 + (i % 5), (i % 4) * 15, 0, 0);
  return d.toISOString();
}

/**
 * Sample bookings to sit under the sample calls, used when
 * DASHBOARD_DEMO_DATA=1 so the funnel renders without a Calendly token.
 *
 * Built to contain the finding the feature exists to produce. Every recorded
 * call gets the booking that produced it, and then the bookings that never
 * became recordings are added on top: cancellations, people who never turned
 * up, and a few that simply were not recorded. The recordings alone imply a
 * show rate around 90%; counting what was actually booked puts it near 79%.
 * That gap is the whole argument for connecting Calendly, so the demo has to
 * show it rather than assert it.
 *
 * No-shows are also given longer booking lead times than shows, so the
 * lead-time panel has a real pattern to find instead of noise.
 */
export function demoBookings(calls: CallRecord[], today: string): BookingRecord[] {
  const rand = seeded(20260816);
  const bookings: BookingRecord[] = [];
  const todayMs = Date.parse(`${today}T00:00:00Z`);

  const answersFor = (i: number) =>
    BOOKING_QUESTIONS.map((question, q) => ({
      question,
      answer: BOOKING_ANSWERS[q][(i + q) % BOOKING_ANSWERS[q].length],
    }));

  const make = (
    partial: Partial<BookingRecord> & {
      id: string;
      email: string;
      name: string;
      scheduled_at: string;
      leadDays: number;
    }
  ): BookingRecord => {
    const { leadDays, ...rest } = partial;
    const bookedAt = new Date(
      Date.parse(partial.scheduled_at) - leadDays * 864e5
    ).toISOString();
    return {
      event_id: `demo-event-${partial.id}`,
      event_type: "Strategy Call",
      booked_at: bookedAt,
      lead_time_days: leadDays,
      status: "active",
      canceled_by_side: null,
      canceled_by: null,
      cancel_reason: null,
      canceled_at: null,
      cancel_notice_hours: null,
      marked_no_show: false,
      rescheduled: false,
      host: null,
      host_email: null,
      tracking: { source: null, medium: null, campaign: null, content: null, term: null },
      answers: [],
      ...rest,
    } as BookingRecord;
  };

  // One booking per recorded call, tied to it by email and date.
  calls.forEach((call, i) => {
    if (!call.call_date || !call.prospect_email) return;
    // Every so often a call has no booking behind it — booked by hand, or on
    // an event type nobody is counting. The panel names these rather than
    // absorbing them, so the sample data has to contain some.
    if (i % 17 === 5) return;
    const daysAgo = Math.round((todayMs - Date.parse(`${call.call_date}T00:00:00Z`)) / 864e5);
    const noShow = call.outcome === "No show";
    // Shows skew towards being booked in the next day or two, no-shows towards
    // a week out. Overlapping rather than separated, because a lead-time panel
    // where every long booking is a no-show would be showing the generator
    // rather than a pattern — the point is a tendency you could act on, not a
    // rule you could not miss.
    const leadDays = noShow
      ? 2 + Math.floor(rand() * 11)
      : Math.floor(rand() * rand() * 14);

    const assignedHost =
      i % 29 === 8
        ? CLOSERS[(CLOSERS.indexOf(call.closer as (typeof CLOSERS)[number]) + 1) % CLOSERS.length]
        : call.closer;

    bookings.push(
      make({
        id: `demo-booking-call-${i}`,
        email: call.prospect_email,
        name: call.name,
        scheduled_at: bookingTime(today, daysAgo, i),
        leadDays,
        // Occasionally the call was assigned to one person and taken by
        // another, which is the disagreement the panel is built to surface.
        host: assignedHost,
        host_email: assignedHost
          ? `${assignedHost.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`
          : null,
        tracking: {
          source: call.lead_source,
          medium: call.lead_source === "Referral" ? "word-of-mouth" : "social",
          campaign: "always-on",
          content: null,
          term: null,
        },
        answers: answersFor(i),
      })
    );
  });

  // Bookings that never produced a recording. Index offsets keep their emails
  // clear of the call emails, so none of them match a call by accident.
  const extra = (
    kind: "canceled" | "marked-no-show" | "unrecorded" | "upcoming",
    n: number,
    spacing: number,
    offset: number
  ) => {
    for (let k = 0; k < n; k++) {
      const i = offset + k;
      const daysAgo = kind === "upcoming" ? -(2 + k * 2) : Math.floor(k * spacing) + 1;
      const scheduled = bookingTime(today, daysAgo, i);
      // The no-shows with no recording behind them lean long too, for the same
      // reason as above: they are most of what fills the far bucket.
      const leadDays =
        kind === "marked-no-show" ? 2 + Math.floor(rand() * 11) : 1 + Math.floor(rand() * 9);
      const base = {
        id: `demo-booking-${kind}-${k}`,
        email: `${kind}.${i}@example.com`,
        name: NAMES[i % NAMES.length],
        scheduled_at: scheduled,
        leadDays,
        host: CLOSERS[i % CLOSERS.length],
        tracking: {
          source: SOURCES[i % SOURCES.length],
          medium: "social",
          campaign: "always-on",
          content: null,
          term: null,
        },
        answers: answersFor(i),
      };

      if (kind === "canceled") {
        // Two in five call it off inside the last day, which is the number
        // that reads as a confirmation problem rather than bad luck.
        const noticeHours = k % 5 < 2 ? 2 + rand() * 20 : 30 + rand() * 90;
        bookings.push(
          make({
            ...base,
            status: "canceled",
            canceled_at: new Date(
              Date.parse(scheduled) - noticeHours * 36e5
            ).toISOString(),
            cancel_notice_hours: noticeHours,
            canceled_by_side: k % 4 === 0 ? "host" : "invitee",
            canceled_by: k % 4 === 0 ? CLOSERS[i % CLOSERS.length] : base.name,
            cancel_reason: k % 3 === 0 ? "Something came up" : null,
          })
        );
      } else if (kind === "marked-no-show") {
        bookings.push(make({ ...base, marked_no_show: true }));
      } else {
        bookings.push(make(base));
      }
    }
  };

  extra("canceled", 19, 4.6, 200);
  extra("marked-no-show", 13, 6.8, 300);
  extra("unrecorded", 9, 9.5, 400);
  extra("upcoming", 6, 1, 500);

  return bookings;
}

/**
 * The demo's client names, keyed by the ids the LOCAL identity service derives
 * for its own demo clients (see dev-demo.js in perceptionismlabkpis, and
 * registryIdFor in its src/index.js).
 *
 * They are here so the shared bar can be driven end to end on a laptop: sign
 * in to the local KPI service, pick a client in the bar, walk over to this app,
 * and the header agrees. Every one of them renders the SAME invented calls —
 * demo mode reads no registry and no tracker — so what is being rehearsed is
 * the choice travelling between systems, not the data.
 */
export const DEMO_CLIENTS = [
  { id: "funded-blueprint-demo", name: "Funded Blueprint (demo)" },
  { id: "northwind-demo", name: "Northwind (demo)" },
];
