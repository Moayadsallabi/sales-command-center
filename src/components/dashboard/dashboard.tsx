"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { CallRecord, OUTCOMES } from "@/lib/types";
import { UNASSIGNED } from "@/lib/stats";
import { callsMissingFxRate, carriesCash, reportingCollected } from "@/lib/money";
import { PaymentDay } from "@/lib/whop";
import { Reconciliation } from "@/lib/reconcile";
import {
  CalendlyState,
  LinkedBooking,
  bookingDate,
  funnelStats,
} from "@/lib/bookings";
import { KPICards } from "./kpi-cards";
import { CoverageAlarm } from "./coverage-alarm";
import { WhopGap } from "./whop-gap";
import { FollowUps } from "./follow-ups";
import { FunnelPanel } from "./funnel-panel";
import { CallTable } from "./call-table";
import { CloserLeaderboard } from "./closer-leaderboard";
import { WhatsCostingYou } from "./whats-costing-you";
import { DimensionImpact } from "./dimension-impact";
import { LeadImpact } from "./lead-impact";
import { ObjectionPanel } from "./objection-panel";
import { ScorecardPanel } from "./scorecard-panel";
import { LiveIndicator } from "./live-indicator";
import { SalesCommandMark } from "@/components/brand/logo";
import { Filter, X } from "lucide-react";

type DateRange = "30d" | "7d" | "90d" | "all";

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
  { value: "all", label: "All time" },
];

const RANGE_DAYS: Record<DateRange, number | null> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  all: null,
};

/** `isoDate` minus `days`, as YYYY-MM-DD. Pure — no clock reading. */
function daysBefore(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split("T")[0];
}

export function Dashboard({
  calls,
  today,
  calendly,
  payments = null,
  reconciliation = null,
  demo = false,
}: {
  calls: CallRecord[];
  today: string;
  calendly: CalendlyState;
  /** Present only when Whop is connected. Null keeps the tracker's figure. */
  payments?: PaymentDay[] | null;
  /** Rows where the processor and the tracker disagree. Null without Whop. */
  reconciliation?: Reconciliation | null;
  demo?: boolean;
}) {
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [selectedOutcomes, setSelectedOutcomes] = useState<Set<string>>(
    new Set()
  );
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set()
  );
  const [selectedCloser, setSelectedCloser] = useState<string | null>(null);
  const [openCall, setOpenCall] = useState<CallRecord | null>(null);

  const allSources = useMemo(() => {
    const sources = new Set<string>();
    calls.forEach((c) => {
      if (c.lead_source) sources.add(c.lead_source);
    });
    return [...sources].sort();
  }, [calls]);

  const filtered = useMemo(() => {
    const days = RANGE_DAYS[dateRange];
    const cutoff = days ? daysBefore(today, days) : null;

    return calls.filter((c) => {
      // Date filter
      if (cutoff && (!c.call_date || c.call_date < cutoff)) return false;
      // Outcome filter
      if (selectedOutcomes.size > 0 && !selectedOutcomes.has(c.outcome ?? ""))
        return false;
      // Source filter
      if (
        selectedSources.size > 0 &&
        !selectedSources.has(c.lead_source ?? "")
      )
        return false;
      return true;
    });
  }, [calls, dateRange, selectedOutcomes, selectedSources, today]);

  // The window immediately before the visible one. Every "vs last period"
  // figure on the page is measured against this, so they all agree. It applies
  // the same outcome and source filters as the visible window — otherwise a
  // filtered view would be compared against an unfiltered past.
  const previous = useMemo(() => {
    const days = RANGE_DAYS[dateRange];
    if (days === null) return [];
    const from = daysBefore(today, days * 2);
    const to = daysBefore(today, days);
    return calls.filter((c) => {
      if (!c.call_date || c.call_date < from || c.call_date >= to) return false;
      if (selectedOutcomes.size > 0 && !selectedOutcomes.has(c.outcome ?? ""))
        return false;
      if (
        selectedSources.size > 0 &&
        !selectedSources.has(c.lead_source ?? "")
      )
        return false;
      return true;
    });
  }, [calls, dateRange, selectedOutcomes, selectedSources, today]);

  // The leaderboard always shows every closer — picking one narrows everything
  // below it, but never hides the people you are being compared against.
  const scoped = useMemo(
    () =>
      selectedCloser === null
        ? filtered
        : filtered.filter((c) => (c.closer ?? UNASSIGNED) === selectedCloser),
    [filtered, selectedCloser]
  );

  const previousScoped = useMemo(
    () =>
      selectedCloser === null
        ? previous
        : previous.filter((c) => (c.closer ?? UNASSIGNED) === selectedCloser),
    [previous, selectedCloser]
  );

  const unrated = useMemo(() => callsMissingFxRate(scoped), [scoped]);

  /**
   * What the processor banked in the visible window, next to what the tracker
   * logged for the same window. The processor's number is the whole business —
   * it cannot follow an outcome pill or a single closer — so the moment any
   * of those filters narrows the view, the tile falls back to the tracker
   * figure, which can.
   */
  const bank = useMemo(() => {
    if (payments === null) return null;
    if (selectedOutcomes.size > 0 || selectedSources.size > 0 || selectedCloser !== null)
      return null;
    const days = RANGE_DAYS[dateRange];
    const cutoff = days ? daysBefore(today, days) : null;
    const collected = payments
      .filter((p) => !cutoff || p.day >= cutoff)
      .reduce((sum, p) => sum + p.amount, 0);
    const trackerLogged = calls
      .filter((c) => !cutoff || (c.call_date && c.call_date >= cutoff))
      .filter(carriesCash)
      .reduce((sum, c) => sum + reportingCollected(c), 0);
    return { collected, trackerLogged };
  }, [payments, calls, dateRange, selectedOutcomes, selectedSources, selectedCloser, today]);

  /**
   * Bookings narrowed the same way the calls above them are, so the funnel and
   * the KPI cards are always describing the same window and the same person.
   *
   * A booking belongs to the closer of the call it produced, and to its
   * Calendly host when it produced none — which is the only way a no-show can
   * be attributed to anyone at all.
   */
  const scopedBookings = useMemo<LinkedBooking[]>(() => {
    if (!calendly.link) return [];
    const days = RANGE_DAYS[dateRange];
    const cutoff = days ? daysBefore(today, days) : null;
    const closerOf = (booking: LinkedBooking) =>
      (booking.call_id ? calls.find((c) => c.id === booking.call_id)?.closer : null) ??
      booking.host ??
      UNASSIGNED;

    return calendly.link.bookings.filter((booking) => {
      if (cutoff && bookingDate(booking) < cutoff) return false;
      if (selectedCloser !== null && closerOf(booking) !== selectedCloser) return false;
      return true;
    });
  }, [calendly.link, calls, dateRange, selectedCloser, today]);

  // Outcome and source pills filter the recordings, not the calendar, so the
  // funnel is left out when either is on rather than shown against a
  // denominator that no longer matches what is being counted. A read that is
  // still coming in is left out for the same reason — a rate off half the
  // bookings is not a rough number, it is the wrong one.
  const funnel = useMemo(
    () =>
      calendly.link &&
      calendly.pending === 0 &&
      selectedOutcomes.size === 0 &&
      selectedSources.size === 0
        ? funnelStats(scopedBookings, scoped)
        : null,
    [
      calendly.link,
      calendly.pending,
      scopedBookings,
      scoped,
      selectedOutcomes,
      selectedSources,
    ]
  );

  const toggleOutcome = (outcome: string) => {
    setSelectedOutcomes((prev) => {
      const next = new Set(prev);
      if (next.has(outcome)) next.delete(outcome);
      else next.add(outcome);
      return next;
    });
  };

  const toggleSource = (source: string) => {
    setSelectedSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const hasFilters =
    selectedOutcomes.size > 0 || selectedSources.size > 0 || selectedCloser !== null;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#09090b]/80 backdrop-blur-xl">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center gap-3"
          >
            <div className="w-8 h-8 rounded-lg bg-gold-500/10 border border-gold-500/20 flex items-center justify-center">
              <SalesCommandMark size={19} className="text-gold-500" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-zinc-100">
                Sales Command Center
              </h1>
              <p className="text-[11px] text-zinc-600">
                {scoped.length} of {calls.length} calls
                {selectedCloser ? ` · ${selectedCloser}` : ""}
              </p>
            </div>
          </motion.div>

          {/* Filters */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
            className="flex items-center gap-2"
          >
            {/* Date range */}
            <div className="flex items-center rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
              {DATE_RANGES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setDateRange(r.value)}
                  className={`px-3 py-1.5 text-[11px] font-medium rounded-md transition-all ${
                    dateRange === r.value
                      ? "bg-gold-500/15 text-gold-400"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* LIVE indicator — drives the 60s auto-refresh */}
            <LiveIndicator />
          </motion.div>
        </div>

        {/* Filter pills row */}
        <div className="max-w-[1400px] mx-auto px-6 pb-3 flex items-center gap-2 flex-wrap">
          <Filter className="w-3 h-3 text-zinc-600" />

          {/* Outcome pills */}
          {OUTCOMES.map((o) => (
            <button
              key={o}
              onClick={() => toggleOutcome(o)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-all ${
                selectedOutcomes.has(o)
                  ? "border-gold-500/30 bg-gold-500/10 text-gold-400"
                  : selectedOutcomes.size > 0
                  ? "border-white/[0.04] bg-transparent text-zinc-600 hover:text-zinc-400"
                  : "border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:text-zinc-300"
              }`}
            >
              {o}
            </button>
          ))}

          <span className="w-px h-4 bg-white/[0.06]" />

          {/* Source pills */}
          {allSources.map((s) => (
            <button
              key={s}
              onClick={() => toggleSource(s)}
              className={`px-2.5 py-1 text-[10px] font-medium rounded-full border transition-all ${
                selectedSources.has(s)
                  ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-400"
                  : selectedSources.size > 0
                  ? "border-white/[0.04] bg-transparent text-zinc-600 hover:text-zinc-400"
                  : "border-white/[0.06] bg-white/[0.02] text-zinc-400 hover:text-zinc-300"
              }`}
            >
              {s}
            </button>
          ))}

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={() => {
                setSelectedOutcomes(new Set());
                setSelectedSources(new Set());
                setSelectedCloser(null);
              }}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
      </header>

      {demo && (
        <div className="border-b border-amber-500/20 bg-amber-500/[0.07] px-6 py-2 text-center text-[11px] text-amber-300">
          Demo data — every call on this page is invented. Unset DASHBOARD_DEMO_DATA to read
          from Notion.
        </div>
      )}

      {/* Calendly connected but unreadable. The page still works off the
          recordings, so this says what is missing rather than blocking it. */}
      {calendly.failure && (
        <div className="border-b border-amber-500/20 bg-amber-500/[0.07] px-6 py-2 text-center text-[11px] text-amber-300">
          {calendly.failure.kind === "unauthorized"
            ? "Calendly rejected the API key, so bookings are not being read. Check CALENDLY_API_KEY."
            : calendly.failure.kind === "forbidden"
            ? "Calendly refused access to these bookings. The token needs to reach the calendars you want counted."
            : "Calendly could not be reached, so bookings are not being read."}{" "}
          Show rate below counts recordings only, which reads higher than the
          real one.
        </div>
      )}

      {/* A deal in another currency with no FX Rate would be converted at 1:1
          and quietly misstate every total below, so it gets named instead. */}
      {unrated.length > 0 && (
        <div className="border-b border-amber-500/20 bg-amber-500/[0.07] px-6 py-2 text-center text-[11px] text-amber-300">
          {unrated.length === 1
            ? `${unrated[0].name || "One call"} is priced in ${unrated[0].currency} with no FX Rate set, so it is counted at 1:1 in the totals below.`
            : `${unrated.length} calls are priced in another currency with no FX Rate set, so they are counted at 1:1 in the totals below.`}{" "}
          Fill in FX Rate in Notion to fix the figures.
        </div>
      )}

      {/* Content */}
      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        {/* THE ORDER OF THIS PAGE, AND WHY.
            ANSWER -> ACT -> UNDERSTAND -> RAW -> DATA HEALTH.

            The numbers come first. Nothing goes above them.

            Two amber panels used to bracket the KPI cards and between them
            take the whole first screen, so every visit opened on a problem
            before it showed a result, and you scrolled past a caveat to reach
            the figure it was cautioning you about. Moayad moved them twice on
            2026-08-18: out of the top, then to the very bottom.

            They sit in a data-health band at the end now, after the raw call
            table. That is the conventional home for reconciliation and
            coverage: they describe how trustworthy the page is, not how the
            business is doing, and a reader goes looking for them when a number
            surprises them rather than being handed them first.

            THE COST, WRITTEN DOWN SO IT IS NOT REDISCOVERED. The coverage
            panel exists because a closer stopped delivering recordings and it
            took five weeks to notice — and it was a footnote at the time. At
            the bottom of a long page it is closer to a footnote again. If a
            stoppage ever goes unspotted, the fix is a one-line strip in the
            header when the panel is alarming, linking down to it — the same
            slim treatment the FX-rate notice already uses — NOT moving the
            panel back up. */}
        <KPICards calls={scoped} funnel={funnel} bank={bank} />

        {/* ACT. The follow-up worklist, above everything that only describes.
            Reads the unfiltered call list: an unworked follow-up does not stop
            being owed when the date filter moves. */}
        <FollowUps calls={calls} today={today} />

        {calendly.link && (
          <FunnelPanel
            bookings={scopedBookings}
            calls={scoped}
            windowStart={calendly.windowStart}
            pending={calendly.pending}
            total={calendly.total}
          />
        )}

        <CloserLeaderboard
          calls={filtered}
          previousCalls={previous}
          selected={selectedCloser}
          onSelect={setSelectedCloser}
        />

        <WhatsCostingYou
          calls={scoped}
          previousCalls={previousScoped}
          closer={selectedCloser}
        />

        {/* The pair, in this order on purpose. The dimensions say how well the
            calls were run; the leads say what they were run on. Reading the
            first without the second is how a traffic problem gets coached. */}
        <DimensionImpact calls={scoped} />

        <LeadImpact calls={scoped} />

        <ObjectionPanel calls={scoped} />

        <CallTable calls={scoped} onSelect={setOpenCall} />

        {/* DATA HEALTH. Everything above describes the business; these two
            describe how much of it the page can actually see.

            Both read the UNFILTERED call list on purpose. Coverage compares
            recent weeks against normal ones, and a seven-day window has no
            normal to compare against; an unruled payment does not stop being
            owed when the date filter moves. */}
        <CoverageAlarm calls={calls} today={today} booked={funnel?.booked ?? null} />

        {reconciliation && <WhopGap reconciliation={reconciliation} />}
      </main>

      <ScorecardPanel
        call={openCall}
        booking={openCall ? calendly.link?.byCallId[openCall.id] ?? null : null}
        onClose={() => setOpenCall(null)}
      />

      {/* Footer */}
      <footer className="border-t border-white/[0.04] mt-8">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between">
          <span className="text-[10px] text-zinc-700 uppercase tracking-[0.15em]">
            {process.env.NEXT_PUBLIC_BRAND_NAME || "Sales Analytics"}
          </span>
          <span className="text-[10px] text-zinc-700 font-mono tabular-nums">
            Data from Notion
          </span>
        </div>
      </footer>
    </div>
  );
}
