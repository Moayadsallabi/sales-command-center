"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AnimatedNumber } from "./animated-number";
import { Sparkline } from "./sparkline";
import { SourceNote, SourceLegend, Source } from "./source-note";
import { Delta } from "./delta";
import { CallRecord } from "@/lib/types";
import { FunnelStats } from "@/lib/bookings";
import { SeriesPoint } from "@/lib/series";
import { cn } from "@/lib/utils";
import {
  carriesCash,
  carriesRevenue,
  closeRateOf,
  formatReporting,
  heldCalls,
  isWin,
  reportingCollected,
  reportingRevenue,
} from "@/lib/money";
import {
  CalendarCheck,
  PhoneCall,
  Target,
  DollarSign,
  Banknote,
  UserPlus,
} from "lucide-react";

interface KPICardsProps {
  calls: CallRecord[];
  /**
   * The same window one period earlier, filtered the same way. Empty for
   * a window with no previous period — every delta hides there rather
   * than comparing against nothing.
   */
  previousCalls: CallRecord[];
  /** What the comparison is against, e.g. "vs 1–19 Jul". */
  comparisonLabel: string;
  /** True when a payment feed is connected at all, filtered or not. */
  payments?: boolean;
  /** Present only when Calendly is connected. Null falls back to recordings. */
  funnel?: FunnelStats | null;
  /**
   * Present only when Whop is connected and no filter narrows the view.
   * `collected` is what the processor banked in the window; `trackerLogged`
   * is what the closers wrote down for the same window. Null keeps the tile
   * on the tracker figure.
   */
  bank?: {
    collected: number;
    trackerLogged: number;
    /** The processor's total for the previous window. Null without one. */
    previousCollected: number | null;
    /** Buyers who first paid inside this window with no call anywhere. */
    missedCount: number;
    /** What those buyers have paid to date — lifetime, not window. */
    missedWorth: number;
  } | null;
  /** Day-by-day cash for the visible window, from whichever source the tile uses. */
  cashSeries?: SeriesPoint[];
  /** Calls in view priced in another currency with no FX rate set. */
  unratedCount?: number;
}

export function KPICards({
  calls,
  previousCalls,
  comparisonLabel,
  funnel = null,
  bank = null,
  payments = false,
  cashSeries = [],
  unratedCount = 0,
}: KPICardsProps) {
  const now = summarise(calls);
  // No previous window means no comparison. An empty array would otherwise
  // report every metric as having fallen 100% from a period that never existed.
  const before = previousCalls.length > 0 ? summarise(previousCalls) : null;

  /**
   * There was a Show Rate tile here. It is gone because it never had an answer
   * to give: with most of the calendar producing no recording either way, the
   * honest figure is a range forty points wide, and a range is not a number
   * anyone can act on. What the calendar can say plainly is how much of it
   * reached this page at all, so that is what sits under Recorded instead.
   */
  const recordedNote =
    funnel && funnel.booked > 0 && funnel.heldRate != null
      ? `${funnel.booked} booked in this window, ${Math.round(
          funnel.heldRate
        )}% produced a recording`
      : "every call that reached the tracker";

  /**
   * With Whop connected the tile shows the money that actually moved, and the
   * note names the gap to what the closers logged — worded for whichever way
   * it runs, because off-platform payments can put the tracker AHEAD of the
   * processor. Inside the tolerance the note stays quiet: fees and rounding
   * are not a discrepancy anyone should be sent to chase.
   */
  const cash = ((): { source: Source; note: string } => {
    // WHICH SOURCE THIS NUMBER CAME FROM, ALWAYS SAID.
    //
    // With Whop connected and nothing filtered, this tile shows what the
    // processor banked. The moment any filter narrows the view the processor's
    // figure cannot follow it — Whop knows nothing about closers or outcomes —
    // so the tile falls back to what the closers logged. That is the right
    // fallback and the wrong silence: the number changed source, and for a
    // while it said so only in the case where it did not change.
    //
    // The dot in front of the note now carries this too, so the change of
    // source is visible before the sentence is read.
    if (bank === null) {
      return {
        source: "tracker",
        note: payments
          ? "Whop's figure covers the whole business, so it cannot follow a filter"
          : "logged by closers after the call",
      };
    }
    const gap = bank.collected - bank.trackerLogged;
    if (Math.abs(gap) < 50)
      return { source: "whop", note: "matches what closers logged" };
    return {
      source: "whop",
      note:
        gap > 0
          ? `closers logged ${formatReporting(
              bank.trackerLogged
            )}, so ${formatReporting(gap)} has no call behind it`
          : `closers logged ${formatReporting(
              bank.trackerLogged
            )}, ${formatReporting(-gap)} of that isn't in Whop`,
    };
  })();

  // WHAT THIS FIGURE CANNOT SEE, SAID NEXT TO IT.
  //
  // Revenue only counts calls that were recorded, so a sale made on a call
  // nobody recorded is missing from it with nothing on the page saying so.
  // This is the size of that hole for the window on screen.
  //
  // "so far" is doing real work: the count is people who FIRST paid inside
  // this window, but the amount is everything they have paid to date, because
  // the payment feed carries no buyer and their share of this window cannot be
  // separated out. Better a slightly wide number that says so than a
  // precise-looking one that is wrong.
  const revenueNote = (() => {
    if (bank === null || bank.missedCount === 0)
      return "closed price of every recorded win";
    const people = bank.missedCount === 1 ? "1 buyer" : `${bank.missedCount} buyers`;
    // Names where the money DOES appear, because the two screens are read side
    // by side and the gap between them is what prompts the question. This
    // dashboard scores calls, so a sale with no call has nothing to score and
    // is deliberately absent; the KPI dashboard counts the business, so it
    // carries the same money under "revenue with no call". Saying so turns a
    // discrepancy into two figures that explain each other.
    return `${people} first paid in this window with no call on the tracker — ${formatReporting(
      bank.missedWorth
    )} so far, counted on the KPI dashboard as revenue with no call, not here`;
  })();

  // A deal in another currency with no FX rate is counted at 1:1, which
  // misstates both money tiles. It used to be a full-width amber band above
  // the numbers; it is a mark on the two figures it actually affects now.
  const fxWarning =
    unratedCount > 0
      ? `${unratedCount} ${
          unratedCount === 1 ? "call is" : "calls are"
        } priced in another currency with no FX rate, and counted at 1:1`
      : null;

  const cashValue = bank?.collected ?? now.cashCollected;
  const cashBefore = bank ? bank.previousCollected : before?.cashCollected ?? null;

  return (
    <div>
      {/* THREE TIERS, NOT SIX EQUALS.
          Six identical cards meant nothing was the headline: on a page called
          Sales Command Center, the money shared the stage with Recorded, which
          is a plumbing metric. Cash is the hero, Revenue sits beside it, and
          the four that describe activity are a row of small tiles underneath.
          Read top-left to bottom-right, that is money, then how it was made. */}
      {/* Three breakpoints, because two left the tablet ugly: at 834px the
          hero and Revenue each took a full row and the four small tiles sat
          two-up under them, which is the phone layout stretched. The middle
          step puts the hero and Revenue side by side at 4:2 and pairs the
          small tiles under them. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6 lg:grid-cols-12 lg:gap-4">
        <Tile
          order={0}
          span="col-span-2 md:col-span-4 lg:col-span-8"
          label="Cash Collected"
          icon={Banknote}
          accent
          hero
          value={cashValue}
          format="currency"
          previous={cashBefore}
          comparisonLabel={comparisonLabel}
          source={cash.source}
          note={cash.note}
          warning={fxWarning}
          series={cashSeries}
        />

        <Tile
          order={1}
          span="col-span-2 md:col-span-2 lg:col-span-4"
          label="Revenue"
          icon={DollarSign}
          accent
          value={now.revenue}
          format="currency"
          previous={before?.revenue ?? null}
          comparisonLabel={comparisonLabel}
          source="tracker"
          note={revenueNote}
          warning={fxWarning}
          // WHAT THE TOTAL IS MADE OF, IN THE SPACE THE TILE HAS ANYWAY.
          // This card is the same height as the hero beside it, and without
          // this it was a number floating in an empty half-tile. The two
          // figures under a revenue total that people actually ask for next
          // are how many deals it took and what the average one was worth.
          breakdown={
            now.customers > 0
              ? [
                  {
                    label: now.customers === 1 ? "deal" : "deals",
                    value: String(now.customers),
                  },
                  {
                    label: "average",
                    value: formatReporting(now.revenue / now.customers),
                  },
                ]
              : undefined
          }
        />

        <Tile
          order={2}
          span="md:col-span-3 lg:col-span-3"
          label="Recorded"
          icon={CalendarCheck}
          value={now.total}
          format="number"
          previous={before?.total ?? null}
          comparisonLabel={comparisonLabel}
          source={funnel ? "calendly" : "tracker"}
          note={recordedNote}
        />
        <Tile
          order={3}
          span="md:col-span-3 lg:col-span-3"
          label="Calls Taken"
          icon={PhoneCall}
          value={now.taken}
          format="number"
          previous={before?.taken ?? null}
          comparisonLabel={comparisonLabel}
          source="tracker"
          note="recordings where the prospect turned up"
        />
        <Tile
          order={4}
          span="md:col-span-3 lg:col-span-3"
          label="Close Rate"
          icon={Target}
          value={now.closeRate}
          format="percent"
          previous={before?.closeRate ?? null}
          deltaUnit="points"
          comparisonLabel={comparisonLabel}
          source="tracker"
          note="wins against calls that were taken"
        />
        <Tile
          order={5}
          span="md:col-span-3 lg:col-span-3"
          label="New Customers"
          icon={UserPlus}
          value={now.customers}
          format="number"
          previous={before?.customers ?? null}
          comparisonLabel={comparisonLabel}
          source="tracker"
          note="calls marked as a win"
        />
      </div>

      <SourceLegend className="mt-3 px-1" />
    </div>
  );
}

/* --------------------------------------------------------------- figures */

/**
 * Every headline number for one set of calls, computed once so the visible
 * window and the previous one can never be worked out two different ways.
 *
 * Which calls count towards a close rate is one rule shared with every panel
 * below — see `carriesClose` in lib/money. This card used to spell it out
 * itself, which is how the page ended up with two answers.
 */
function summarise(calls: CallRecord[]) {
  // Every total is converted into the reporting currency first, so a euro
  // retainer and a dollar sprint can sit in the same number honestly.
  //
  // Revenue counts wins; cash counts money that moved. A deposit taken while
  // booking a follow-up belongs in the second and not the first, which is why
  // the two use different sets rather than both filtering to customers.
  return {
    total: calls.length,
    taken: heldCalls(calls).length,
    customers: calls.filter(isWin).length,
    closeRate: Math.round(closeRateOf(calls) ?? 0),
    revenue: calls
      .filter(carriesRevenue)
      .reduce((sum, c) => sum + reportingRevenue(c), 0),
    cashCollected: calls
      .filter(carriesCash)
      .reduce((sum, c) => sum + reportingCollected(c), 0),
  };
}

/* ----------------------------------------------------------------- tile */

function Tile({
  order,
  span,
  label,
  icon: Icon,
  value,
  format,
  previous,
  deltaUnit = "ratio",
  comparisonLabel,
  source,
  note,
  warning = null,
  series,
  breakdown,
  accent = false,
  hero = false,
}: {
  order: number;
  span: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  value: number;
  format: "number" | "currency" | "percent";
  previous: number | null;
  deltaUnit?: "ratio" | "points";
  comparisonLabel: string;
  source: Source;
  note: string;
  warning?: string | null;
  series?: SeriesPoint[];
  /** What the headline is made of, for a tile with room to say it. */
  breakdown?: { label: string; value: string }[];
  accent?: boolean;
  hero?: boolean;
}) {
  const still = useReducedMotion();
  const motionProps = still
    ? { initial: false as const }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        transition: {
          delay: order * 0.025,
          duration: 0.28,
          ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
        },
      };

  return (
    <motion.div
      {...motionProps}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.06] p-4 transition-colors duration-200 hover:border-white/[0.12]",
        span,
        accent
          ? "bg-gradient-to-br from-gold-500/[0.07] to-transparent glow-gold"
          : "glass-card",
        hero ? "lg:p-6" : "lg:p-5"
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="t-label text-zinc-400">{label}</span>
        <Icon
          className={cn("h-4 w-4 shrink-0", accent ? "text-gold-500" : "text-zinc-500")}
          strokeWidth={1.5}
        />
      </div>

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
        <AnimatedNumber
          value={value}
          format={format}
          className={cn(
            "font-mono font-bold tracking-tight tabular-nums",
            hero ? "text-4xl lg:text-5xl" : accent ? "text-2xl lg:text-3xl" : "text-2xl",
            accent ? "text-gold-400" : "text-zinc-100"
          )}
        />
        <Delta
          current={value}
          previous={previous}
          unit={deltaUnit}
          label={comparisonLabel}
        />
      </div>

      {/* The hero tile's window, drawn. It sits between the number and the
          note so the eye goes total, then shape, then caveat — and it takes
          the vertical space these cards were padding with nothing. */}
      {hero && series && series.length > 1 && (
        <Sparkline
          points={series}
          height={64}
          className="mt-4"
          // The label now names a real period ("vs 1–19 Jul"), so the swap is
          // on the leading "vs " rather than on the old "vs prev" wording,
          // which stopped matching and left "…window, vs 1–19 Jul".
          label={`Cash collected per day across the window, ${comparisonLabel.replace(
            /^vs (prev )?/,
            (_m, prev) => (prev ? "compared with the previous " : "compared with ")
          )}`}
        />
      )}

      {breakdown && breakdown.length > 0 && (
        <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
          {breakdown.map((item) => (
            <div key={item.label}>
              <dt className="t-label text-zinc-500">{item.label}</dt>
              <dd className="mt-0.5 font-mono text-[15px] tabular-nums text-zinc-200">
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* Pushed to the bottom edge so the source line is on the same baseline
          across a row of tiles of different heights. */}
      <div className="mt-auto pt-3">
        <SourceNote source={source}>{note}</SourceNote>
        {warning && (
          <p className="mt-1.5 pl-3 text-[11px] leading-snug text-amber-300/90">
            {warning}
          </p>
        )}
      </div>
    </motion.div>
  );
}
