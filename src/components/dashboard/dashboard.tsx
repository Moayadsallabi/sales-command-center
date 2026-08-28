"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { CallRecord, OUTCOMES } from "@/lib/types";
import { UNASSIGNED } from "@/lib/stats";
import { callsMissingFxRate, carriesCash, reportingCollected } from "@/lib/money";
import { PaymentDay } from "@/lib/whop";
import { Reconciliation, windowReconciliation } from "@/lib/reconcile";
import {
  CalendlyState,
  LinkedBooking,
  bookingDate,
  funnelStats,
} from "@/lib/bookings";
import { cashSeries } from "@/lib/series";
import {
  DATE_RANGES,
  DateRange,
  DateWindow,
  daysBetween,
  monthEnd,
  monthStart,
  presetWindow,
  previousWindow,
  shortDate,
  withinWindow,
} from "@/lib/periods";
import { Panel, usePanelMotion } from "./panel";
import { KPICards } from "./kpi-cards";
import { CoverageAlarm } from "./coverage-alarm";
import { WhopGap } from "./whop-gap";
import { FollowUps } from "./follow-ups";
import { CallTable, ExcludedNote } from "./call-table";
import { CloserLeaderboard } from "./closer-leaderboard";
import { WhatsCostingYou } from "./whats-costing-you";
import { DimensionImpact } from "./dimension-impact";
import { LeadImpact } from "./lead-impact";
import { ObjectionPanel } from "./objection-panel";
import { ScorecardPanel } from "./scorecard-panel";
import { LiveIndicator } from "./live-indicator";
import { NavSection, SectionNav, useSectionNav } from "./section-nav";
import { SwitchFailure } from "./switch-failure";
import { SalesCommandMark } from "@/components/brand/logo";
import {
  Activity,
  AlertTriangle,
  Coins,
  Gauge,
  List,
  MessageSquareWarning,
  PhoneForwarded,
  Trophy,
  UserSearch,
  X,
} from "lucide-react";

/**
 * THE PAGE'S OWN TABLE OF CONTENTS, IN READING ORDER.
 *
 * Same list, same order, same icons as the panels themselves — a section that
 * moves up the page moves up the rail, because both come from here. Each `id`
 * has to match the wrapper it names in the markup below; nothing else on the
 * page carries these strings.
 */
const SECTIONS: NavSection[] = [
  { id: "numbers", label: "The numbers", icon: Gauge },
  { id: "closers", label: "Closers", icon: Trophy },
  { id: "costing", label: "What is costing you", icon: AlertTriangle },
  { id: "call-parts", label: "Parts of the call", icon: Coins },
  { id: "leads", label: "What leads are worth", icon: UserSearch },
  { id: "objections", label: "Objections", icon: MessageSquareWarning },
  { id: "calls", label: "All calls", icon: List },
  { id: "follow-ups", label: "Follow-ups", icon: PhoneForwarded },
  { id: "data-health", label: "Data health", icon: Activity },
];

export function Dashboard({
  calls,
  today,
  calendly,
  payments = null,
  reconciliation = null,
  excluded = [],
  demo = false,
  brandName: brandNameProp,
  switchError = null,
}: {
  calls: CallRecord[];
  today: string;
  calendly: CalendlyState;
  /**
   * Whose dashboard this is, resolved on the server.
   *
   * It used to come from NEXT_PUBLIC_BRAND_NAME, which Next bakes into the
   * bundle AT BUILD TIME. That is invisible while one deployment serves one
   * client and impossible the moment it serves two: every visitor would see
   * whichever name was set when the image was built. A prop is the only shape
   * that can differ per request.
   *
   * Undefined falls back to the variable, so the existing per-client
   * deployments render exactly as they do today.
   */
  brandName?: string | null;
  /** Set when a pinned client could not be opened, so the page can say so. */
  switchError?: string | null;
  /** Present only when Whop is connected. Null keeps the tracker's figure. */
  payments?: PaymentDay[] | null;
  /** Rows where the processor and the tracker disagree. Null without Whop. */
  reconciliation?: Reconciliation | null;
  /**
   * Tracker rows left out because they belong to another offer. Passed down
   * only to be SAID on the page: the list they come from holds whatever a
   * person remembered to add, so a page that dropped rows silently would give
   * a stale list nowhere to show.
   */
  excluded?: ExcludedNote[];
  demo?: boolean;
}) {
  const [dateRange, setDateRange] = useState<DateRange>("month");
  // Seeded with the opening preset's own dates, so the fields are never empty
  // when Custom is first picked. An empty end date reads as "no upper bound",
  // which would quietly show everything since the start date.
  const [customFrom, setCustomFrom] = useState<string>(() => monthStart(today));
  const [customTo, setCustomTo] = useState<string>(today);
  const [selectedOutcomes, setSelectedOutcomes] = useState<Set<string>>(
    new Set()
  );
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set()
  );
  const [selectedCloser, setSelectedCloser] = useState<string | null>(null);
  const [openCall, setOpenCall] = useState<CallRecord | null>(null);
  const nav = useSectionNav();

  const allSources = useMemo(() => {
    const sources = new Set<string>();
    calls.forEach((c) => {
      if (c.lead_source) sources.add(c.lead_source);
    });
    return [...sources].sort();
  }, [calls]);

  /**
   * THE PERIOD ON SCREEN, AND THE ONLY DEFINITION OF IT. The KPI cards, the
   * cash tile, the bookings and the leaderboard all narrow through this, so a
   * date change cannot move one number on the page and leave another behind.
   */
  const visibleWindow = useMemo<DateWindow>(() => {
    if (dateRange !== "custom") return presetWindow(today, dateRange);
    // Picking an end date before the start date is a slip, not a request for
    // an empty page, so the pair is read in whichever order makes a range.
    const [from, to] =
      customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
    return { from, to };
  }, [dateRange, customFrom, customTo, today]);

  /**
   * THE COMPARISON PERIOD, WORKED OUT ONCE. The KPI deltas, the cash tile and
   * the label under them all read this, so "vs last month" cannot mean July
   * in one place and mid-July in another.
   */
  const priorWindow = useMemo(
    () => previousWindow(visibleWindow, dateRange),
    [visibleWindow, dateRange]
  );

  const filtered = useMemo(() => {
    return calls.filter((c) => {
      // Date filter
      if (!withinWindow(c.call_date, visibleWindow)) return false;
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
  }, [calls, visibleWindow, selectedOutcomes, selectedSources]);

  // The window immediately before the visible one. Every "vs last period"
  // figure on the page is measured against this, so they all agree. It applies
  // the same outcome and source filters as the visible window — otherwise a
  // filtered view would be compared against an unfiltered past.
  const previous = useMemo(() => {
    const prior = priorWindow;
    if (prior === null) return [];
    return calls.filter((c) => {
      if (!withinWindow(c.call_date, prior)) return false;
      if (selectedOutcomes.size > 0 && !selectedOutcomes.has(c.outcome ?? ""))
        return false;
      if (
        selectedSources.size > 0 &&
        !selectedSources.has(c.lead_source ?? "")
      )
        return false;
      return true;
    });
  }, [calls, priorWindow, selectedOutcomes, selectedSources]);

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
   * THE WHOP DISAGREEMENTS, NARROWED TO THE PERIOD ON SCREEN.
   *
   * The windowing itself lives in lib/reconcile.ts, where the note explains
   * which date each half is placed by and why the money stays a lifetime
   * total. What belongs here is the window: this component owns the date
   * buttons, so it is the only thing that knows what "this month" means.
   *
   * The outcome and source pills are deliberately NOT applied. They narrow to
   * a kind of call, and this panel's whole subject is rows whose recorded
   * outcome is wrong — filtering on that field would hide the rows by the very
   * thing being disputed.
   */
  const scopedReconciliation = useMemo(
    () =>
      reconciliation === null
        ? null
        : windowReconciliation(reconciliation, (date) =>
            withinWindow(date, visibleWindow)
          ),
    [reconciliation, visibleWindow]
  );

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
    const collected = payments
      .filter((p) => withinWindow(p.day, visibleWindow))
      .reduce((sum, p) => sum + p.amount, 0);
    const trackerLogged = calls
      .filter((c) => withinWindow(c.call_date, visibleWindow))
      .filter(carriesCash)
      .reduce((sum, c) => sum + reportingCollected(c), 0);
    // WHAT UNRECORDED CALLS COST, FOR THIS WINDOW ONLY.
    //
    // Revenue adds up the closed price of calls that were RECORDED, so a sale
    // made on a call nobody recorded is invisible to it. The panel at the
    // bottom of the page already counts those buyers, but over all time and
    // over everything they have ever paid — which reads as a monthly figure
    // and is not one. Moayad read it that way on 2026-08-18, correctly asking
    // whether Revenue was low because calls went unrecorded.
    //
    // Windowed on `first`, the buyer's earliest payment: someone who first
    // bought inside this window and has no call anywhere is a sale this window
    // should have counted and could not. `paid` stays their lifetime total —
    // the payment feed is day-and-amount with no buyer on it, so their share
    // of THIS window's money cannot be isolated. The wording says "so far"
    // rather than implying it all landed here.
    //
    // A DATE IS ONLY REQUIRED WHEN THERE IS A WINDOW TO TEST IT AGAINST.
    //
    // Written the other way round first — `b.first && (!cutoff || ...)` — which
    // silently dropped undated buyers whenever the window was open at both
    // ends, so this line and the panel at the bottom of the page reported
    // different counts for the same set. Two numbers for one thing is the
    // fault this dashboard has spent the day removing.
    const newUntracked = reconciliation
      ? reconciliation.untrackedBuyers.filter(
          (b) =>
            (visibleWindow.from === null && visibleWindow.to === null) ||
            (b.first != null && withinWindow(b.first, visibleWindow))
        )
      : [];

    // THE SAME TOTAL, ONE PERIOD EARLIER, FROM THE SAME SOURCE. The delta on
    // the cash tile has to compare like with like: the processor's figure
    // against the processor's figure, never against what closers logged. An
    // unbounded window has no previous period, so it has no baseline either.
    const prior = priorWindow;
    const previousCollected =
      prior === null
        ? null
        : payments
            .filter((p) => withinWindow(p.day, prior))
            .reduce((sum, p) => sum + p.amount, 0);

    return {
      collected,
      trackerLogged,
      previousCollected,
      missedCount: newUntracked.length,
      missedWorth: newUntracked.reduce((sum, b) => sum + b.paid, 0),
    };
  }, [payments, calls, reconciliation, visibleWindow, priorWindow, selectedOutcomes, selectedSources, selectedCloser]);

  /**
   * The cash line drawn under the cash total, built from whichever source that
   * total came from — the processor when the tile is showing Whop's figure,
   * the closers' own rows when a filter has narrowed the view and Whop can no
   * longer follow it. Two different answers stacked on top of each other is
   * exactly the fault this page spent a day removing.
   */
  const series = useMemo(
    () => cashSeries(visibleWindow, bank ? payments : null, scoped),
    [visibleWindow, bank, payments, scoped]
  );

  /**
   * THE DATES THE PAGE IS ACTUALLY SHOWING, SPELLED OUT. A button reading
   * "This month" cannot show an off-by-one; two real dates can, which is how
   * the eight-day week was caught.
   *
   * A one-day window says the day once. "19 Aug – 19 Aug · 1 days" was what
   * the Today button produced on the day it was added: a range whose two ends
   * are the same date reads as a rendering fault, and "1 days" reads as one
   * too — twice over, on the smallest window, where there is least else on
   * screen to reassure you.
   */
  const windowLabel = useMemo(() => {
    const { from, to } = visibleWindow;
    if (!from || !to) return "Every call on record";
    if (from === to) return `${shortDate(from)} · 1 day`;
    return `${shortDate(from)} – ${shortDate(to)} · ${daysBetween(from, to)} days`;
  }, [visibleWindow]);

  /**
   * What every delta on the page is measured against, NAMED RATHER THAN
   * COUNTED. "vs prev 19 days" is true and unusable: with calendar presets the
   * reader cannot tell which 19 days, and a comparison you cannot name is one
   * you cannot act on. Custom keeps the count, because a hand-picked range has
   * no name to give.
   */
  const comparisonLabel = useMemo(() => {
    const prior = priorWindow;
    if (prior === null) return "";
    if (dateRange === "custom") return `vs prev ${daysBetween(prior.from!, prior.to!)} days`;
    if (dateRange === "today") return `vs ${shortDate(prior.from!)}`;
    if (dateRange === "week" || dateRange === "lastweek")
      return `vs ${shortDate(prior.from!)} – ${shortDate(prior.to!)}`;
    if (dateRange === "year") return `vs ${shortDate(prior.from!)} – ${shortDate(prior.to!)} ${prior.from!.slice(0, 4)}`;
    // A whole month is named; a part-month says which part, so "vs Jul" can
    // never claim all of July while holding its first nineteen days.
    const full = prior.to === monthEnd(prior.to!);
    const name = new Date(`${prior.to}T00:00:00Z`).toLocaleDateString("en-GB", {
      month: "short",
      timeZone: "UTC",
    });
    return full ? `vs ${name}` : `vs 1–${Number(prior.to!.slice(8, 10))} ${name}`;
  }, [priorWindow, dateRange]);

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
    const closerOf = (booking: LinkedBooking) =>
      (booking.call_id ? calls.find((c) => c.id === booking.call_id)?.closer : null) ??
      booking.host ??
      UNASSIGNED;

    return calendly.link.bookings.filter((booking) => {
      if (!withinWindow(bookingDate(booking), visibleWindow)) return false;
      if (selectedCloser !== null && closerOf(booking) !== selectedCloser) return false;
      return true;
    });
  }, [calendly.link, calls, visibleWindow, selectedCloser]);

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
  const activeFilterCount =
    selectedOutcomes.size + selectedSources.size + (selectedCloser ? 1 : 0);

  /**
   * EVERYTHING WRONG WITH THE DATA, IN ONE LIST.
   *
   * Each of these used to be its own full-width amber strip stacked above the
   * numbers. Collected here they can be counted in the header as a single line
   * and explained at the foot of the page, which is the order a reader
   * actually wants: the result first, the reasons to doubt it within reach.
   */
  const issues = useMemo(() => {
    const found: { id: string; title: string; body: string }[] = [];

    /* Calendly connected and being read for the first time. Said out loud
       because the alternative is a page that looks exactly like a client with
       no calendar connected: every rate counted from recordings, nothing on
       screen admitting the denominator is missing. It clears itself on the
       next refresh, which is a minute away at most. */
    if (calendly.reading) {
      found.push({
        id: "calendly-reading",
        title: "Still reading the calendar",
        body:
          "The bookings behind these calls are being read from Calendly now. " +
          "Until they arrive, everything here is counted from recordings alone, " +
          "so the show rate and the funnel are missing the people who never " +
          "turned up. This page refreshes itself every minute.",
      });
    }

    // Calendly connected but unreadable. The page still works off the
    // recordings, so this says what is missing rather than blocking it.
    if (calendly.failure) {
      found.push({
        id: "calendly",
        title: "Bookings are not being read",
        body:
          (calendly.failure.kind === "unauthorized"
            ? "Calendly rejected the API key. Check CALENDLY_API_KEY."
            : calendly.failure.kind === "forbidden"
            ? "Calendly refused access to these bookings. The token needs to reach the calendars you want counted."
            : "Calendly could not be reached.") +
          " Everything on this page is counted from recordings alone, so the share of the calendar that reached the tracker reads higher than it is.",
      });
    }

    // A deal in another currency with no FX Rate would be converted at 1:1 and
    // quietly misstate every total, so it gets named — on the two money tiles
    // it affects, and here in full.
    if (unrated.length > 0) {
      found.push({
        id: "fx",
        title:
          unrated.length === 1
            ? "One deal has no exchange rate"
            : `${unrated.length} deals have no exchange rate`,
        body:
          unrated.length === 1
            ? `${unrated[0].name || "One call"} is priced in ${
                unrated[0].currency
              } with no FX Rate set, so it is counted at 1:1 in Cash Collected and Revenue. Fill in FX Rate in Notion to fix both figures.`
            : `${unrated.length} calls are priced in another currency with no FX Rate set, so they are counted at 1:1 in Cash Collected and Revenue. Fill in FX Rate in Notion to fix both figures.`,
      });
    }

    return found;
  }, [calendly.failure, calendly.reading, unrated]);

  const titleMotion = usePanelMotion(0);
  const controlsMotion = usePanelMotion(1);

  /* WHOSE DASHBOARD THIS IS.
     NEXT_PUBLIC_BRAND_NAME is the client's own business name, already set per
     deployment and until now only spent on the footer. It belongs at the top:
     the product name is the same on every client's copy, so it identifies
     nothing, and a screenshot of this page arriving in a thread should say who
     it is about without anyone captioning it. When the variable is unset the
     header is exactly what it was — product name as the title, no eyebrow. */
  const brandName = (brandNameProp ?? process.env.NEXT_PUBLIC_BRAND_NAME)?.trim() || null;

  return (
    /* The rail is fixed to the viewport so it survives scrolling, which means
       it takes up no space of its own — this padding is what stops it sitting
       on top of the header and the panels. Below `lg` the rail is a drawer
       instead, and there is no gap to leave. */
    <div
      className={`min-h-screen transition-[padding] duration-200 ${
        nav.collapsed ? "lg:pl-14" : "lg:pl-56"
      }`}
    >
      <SectionNav
        sections={SECTIONS}
        collapsed={nav.collapsed}
        onToggle={nav.toggle}
      />

      {/* HEADER — ONE TITLE ROW, THEN ONE TOOLBAR.
          The title block, both filter families, the date presets, the custom
          date fields and the live indicator all used to share a two-row
          header, and below about 1100px they collided: at phone width the
          title wrapped to three lines and the range buttons landed on top of
          it. Identity and period on the first row, filtering on the second,
          and each row is allowed to scroll sideways rather than wrap. */}
      <header className="shell-offset-top sticky top-0 z-40 border-b border-white/[0.06] bg-[#09090b]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 sm:px-6">
          <motion.div
            {...titleMotion}
            className="flex min-w-[170px] flex-1 items-center gap-3"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-gold-500/20 bg-gold-500/10">
              <SalesCommandMark size={24} className="text-gold-500" />
            </div>
            <div className="min-w-0">
              {brandName && (
                <div className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-gold-500">
                  Sales Command Center
                </div>
              )}
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[15px] font-semibold tracking-tight text-zinc-100">
                  {brandName ?? "Sales Command Center"}
                </h1>
                {/* Invented data has to be unmistakable, and it used to say so
                    in a full-width amber band that pushed the numbers down the
                    page. A pill welded to the title travels with the title and
                    costs no vertical space. */}
                {demo && (
                  <span
                    title="Every call on this page is invented. Unset DASHBOARD_DEMO_DATA to read from Notion."
                    className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/[0.12] px-2 py-0.5 text-[11px] font-medium text-amber-300"
                  >
                    Demo data
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-zinc-400">
                {scoped.length} of {calls.length} calls
                {selectedCloser ? ` · ${selectedCloser}` : ""}
              </p>
            </div>

            {/* ONE LINE WHEN SOMETHING IS WRONG, NOT THREE BANDS.
                Three stacked amber strips sat above the numbers and were the
                loudest thing on the page — every visit opened on a caveat
                before it showed a result. The caveats now live in the
                data-health band at the foot of the page, where a reader goes
                when a figure surprises them, and this is the pointer down to
                them. Amber is spent here and nowhere above the fold.

                It rides with the TITLE rather than with the date controls: on
                a phone those controls already fill their row, and a chip
                squeezed in beside them landed on top of the range buttons. */}
            {issues.length > 0 && (
              <a
                href="#data-health"
                className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-500/25 bg-amber-500/[0.08] px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-colors hover:bg-amber-500/[0.14]"
              >
                <AlertTriangle className="h-3 w-3" strokeWidth={2} />
                {issues.length} to check
              </a>
            )}
          </motion.div>

          <motion.div
            {...controlsMotion}
            className="flex w-full min-w-0 items-center gap-3 sm:w-auto sm:justify-end"
          >
            {/* DATE RANGE. The presets answer "how is this week going". The
                two date fields answer "what happened between these dates",
                which is what reading a launch week, an ad flight or a single
                month back needs, and no preset can express. */}
            <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5 sm:flex-none sm:items-end">
              <div className="flex w-full min-w-0 items-center gap-2">
                {dateRange === "custom" && (
                  <div className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gold-500/20 bg-gold-500/[0.06] px-2 py-1">
                    {/* An empty value would mean "unbounded" to the filter, so
                        a cleared field keeps the date it had. */}
                    <input
                      type="date"
                      value={customFrom}
                      max={today}
                      onChange={(e) => e.target.value && setCustomFrom(e.target.value)}
                      aria-label="From date"
                      className="bg-transparent text-[11px] font-medium text-zinc-300 outline-none [color-scheme:dark] hover:text-zinc-100 focus:text-gold-400"
                    />
                    <span className="text-[11px] text-zinc-400">to</span>
                    <input
                      type="date"
                      value={customTo}
                      max={today}
                      onChange={(e) => e.target.value && setCustomTo(e.target.value)}
                      aria-label="To date"
                      className="bg-transparent text-[11px] font-medium text-zinc-300 outline-none [color-scheme:dark] hover:text-zinc-100 focus:text-gold-400"
                    />
                  </div>
                )}

                {/* `min-w-0` is what lets this scroll instead of pushing the
                    live indicator off the edge — without it a flex child
                    refuses to shrink below its content and the whole header
                    overflows rather than the button strip scrolling. */}
                <div className="scroll-x flex min-w-0 items-center rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5">
                  {DATE_RANGES.map((r) => (
                    <button
                      key={r.value}
                      onClick={() => {
                        // Custom opens on whatever is already on screen rather
                        // than jumping somewhere else, so the switch shows the
                        // same numbers until a date is actually moved.
                        if (r.value === "custom" && dateRange !== "custom") {
                          if (visibleWindow.from) setCustomFrom(visibleWindow.from);
                          if (visibleWindow.to) setCustomTo(visibleWindow.to);
                        }
                        setDateRange(r.value);
                      }}
                      className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors ${
                        dateRange === r.value
                          ? "bg-gold-500/15 text-gold-400"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <p className="truncate text-[11px] tabular-nums text-zinc-400">
                {windowLabel}
              </p>
            </div>

            {/* LIVE indicator — drives the 60s auto-refresh */}
            <LiveIndicator />
          </motion.div>
        </div>

        {/* FILTER TOOLBAR. Ten pills used to sit in one undifferentiated line
            with a 1px rule somewhere in the middle as the only clue that they
            were two different questions. Each family is named now, and the row
            scrolls sideways on a narrow screen instead of wrapping into three. */}
        <div className="scroll-x border-t border-white/[0.04]">
          <div className="mx-auto flex max-w-[1400px] items-center gap-4 px-4 py-2.5 sm:px-6">
            <FilterGroup label="Outcome">
              {OUTCOMES.map((o) => (
                <FilterPill
                  key={o}
                  active={selectedOutcomes.has(o)}
                  dimmed={selectedOutcomes.size > 0 && !selectedOutcomes.has(o)}
                  tone="gold"
                  onClick={() => toggleOutcome(o)}
                >
                  {o}
                </FilterPill>
              ))}
            </FilterGroup>

            <span className="h-5 w-px shrink-0 bg-white/[0.08]" />

            <FilterGroup label="Source">
              {allSources.map((s) => (
                <FilterPill
                  key={s}
                  active={selectedSources.has(s)}
                  dimmed={selectedSources.size > 0 && !selectedSources.has(s)}
                  tone="indigo"
                  onClick={() => toggleSource(s)}
                >
                  {s}
                </FilterPill>
              ))}
            </FilterGroup>

            {hasFilters && (
              <button
                onClick={() => {
                  setSelectedOutcomes(new Set());
                  setSelectedSources(new Set());
                  setSelectedCloser(null);
                }}
                className="ml-auto flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] text-zinc-300 transition-colors hover:border-white/20 hover:text-zinc-100"
              >
                <X className="h-3 w-3" />
                Clear {activeFilterCount} {activeFilterCount === 1 ? "filter" : "filters"}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-[1400px] space-y-6 px-4 py-6 sm:px-6">
        {/* THE ORDER OF THIS PAGE, AND WHY.
            ANSWER -> UNDERSTAND -> RAW -> ACT -> DATA HEALTH.

            The numbers come first. Nothing goes above them.

            The follow-up worklist used to sit second, directly under
            them. Moayad moved it to the end on 2026-08-28: the page
            is read top to bottom to find out how the selling is
            going, and a list of people to chase is what you act on
            once you know. It is the only panel below that is a to-do
            rather than a description, so it sits on its own at the
            foot of the business sections, under the raw call table
            and above the data-health band.

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
            panel back up.

            THE ORDER PROP. Every panel takes its position in this list and
            turns it into its entrance delay, so reading order and animation
            order are one list rather than ten hand-written numbers that drift
            apart when a panel moves. See components/dashboard/panel.tsx. */}
        {/* Each section below is wrapped in an id the rail links to, and
            `scroll-mt` is what keeps its heading clear of the sticky header
            when it is jumped to rather than scrolled to. */}
        {/* The one thing allowed above the numbers, because it says the
            numbers are not whose the header says they are. */}
        {switchError && <SwitchFailure message={switchError} />}

        <div id="numbers" className="scroll-mt-32">
          <KPICards
            calls={scoped}
            previousCalls={previousScoped}
            comparisonLabel={comparisonLabel}
            funnel={funnel}
            bank={bank}
            payments={payments !== null}
            cashSeries={series}
            unratedCount={unrated.length}
          />
        </div>

        <div id="closers" className="scroll-mt-32">
          <CloserLeaderboard
            order={2}
            calls={filtered}
            previousCalls={previous}
            selected={selectedCloser}
            onSelect={setSelectedCloser}
          />
        </div>

        <div id="costing" className="scroll-mt-32">
          <WhatsCostingYou
            order={3}
            calls={scoped}
            previousCalls={previousScoped}
            comparisonLabel={comparisonLabel}
            closer={selectedCloser}
          />
        </div>

        {/* The pair, in this order on purpose. The dimensions say how well the
            calls were run; the leads say what they were run on. Reading the
            first without the second is how a traffic problem gets coached. */}
        <div id="call-parts" className="scroll-mt-32">
          <DimensionImpact order={4} calls={scoped} />
        </div>

        <div id="leads" className="scroll-mt-32">
          <LeadImpact order={5} calls={scoped} />
        </div>

        <div id="objections" className="scroll-mt-32">
          <ObjectionPanel order={6} calls={scoped} />
        </div>

        <div id="calls" className="scroll-mt-32">
          <CallTable
            order={7}
            calls={scoped}
            onSelect={setOpenCall}
            excluded={excluded}
          />
        </div>

        {/* ACT. The one panel here that asks you to do something rather than
            telling you how things went, so it comes after everything that
            describes and before the band that only says how much of the
            business this page can see.

            Reads the unfiltered call list: an unworked follow-up does not stop
            being owed when the date filter moves. */}
        <div id="follow-ups" className="scroll-mt-32">
          <FollowUps order={8} calls={calls} today={today} />
        </div>

        {/* DATA HEALTH. Everything above describes the business; these
            describe how much of it the page can actually see.

            The panels read the UNFILTERED call list on purpose. Coverage
            compares recent weeks against normal ones, and a seven-day window
            has no normal to compare against; an unruled payment does not stop
            being owed when the date filter moves.

            The band is now the destination of the "n to check" link in the
            header, and holds the notices that used to be amber strips above
            the numbers. `scroll-mt` keeps the heading clear of the sticky
            header when that link jumps here. */}
        <section id="data-health" className="scroll-mt-32 space-y-6 pt-2">
          <div className="flex items-center gap-3">
            <h2 className="t-label text-zinc-400">Data health</h2>
            <span className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[11px] text-zinc-400">
              How much of the business this page can see
            </span>
          </div>

          {issues.map((issue) => (
            <Panel key={issue.id} order={9} tone="alert">
              <div className="flex items-start gap-2.5">
                <AlertTriangle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400"
                  strokeWidth={1.5}
                />
                <div className="min-w-0">
                  <h3 className="t-label text-amber-300">{issue.title}</h3>
                  <p className="mt-1.5 max-w-[80ch] t-body text-zinc-300">
                    {issue.body}
                  </p>
                </div>
              </div>
            </Panel>
          ))}

          <CoverageAlarm
            order={10}
            calls={calls}
            today={today}
            booked={funnel?.booked ?? null}
          />

          {scopedReconciliation && (
            <WhopGap
              order={11}
              reconciliation={scopedReconciliation}
              windowLabel={
                visibleWindow.from === null && visibleWindow.to === null
                  ? null
                  : windowLabel
              }
            />
          )}
        </section>
      </main>

      <ScorecardPanel
        call={openCall}
        booking={openCall ? calendly.link?.byCallId[openCall.id] ?? null : null}
        onClose={() => setOpenCall(null)}
      />

      {/* Footer */}
      <footer className="mt-8 border-t border-white/[0.04]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6">
          <span className="text-[11px] uppercase tracking-[0.15em] text-zinc-400">
            {brandName || "Sales Analytics"}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-zinc-400">
            Calls from Notion · bookings from Calendly · money from Whop
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------- toolbar */

/**
 * One named family of filter pills.
 *
 * The name is the whole point. Ten pills used to sit in a single row with a
 * hairline somewhere in the middle as the only sign that the first six
 * answered "how did the call end" and the last four answered "where did the
 * lead come from". Nothing said so, and clicking one from each family reads as
 * an AND that nobody was told about.
 */
function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="t-label shrink-0 text-zinc-500">{label}</span>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

function FilterPill({
  active,
  dimmed,
  tone,
  onClick,
  children,
}: {
  active: boolean;
  /** Another pill in this family is on, so this one is currently excluded. */
  dimmed: boolean;
  tone: "gold" | "indigo";
  onClick: () => void;
  children: React.ReactNode;
}) {
  const on =
    tone === "gold"
      ? "border-gold-500/30 bg-gold-500/10 text-gold-400"
      : "border-indigo-500/30 bg-indigo-500/10 text-indigo-300";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? on
          : dimmed
          ? // Excluded, not disabled. It was zinc-600 on transparent, which
            // measured 2.6:1 and read as broken rather than as off.
            "border-white/[0.05] bg-transparent text-zinc-500 hover:text-zinc-300"
          : "border-white/[0.08] bg-white/[0.02] text-zinc-300 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}
