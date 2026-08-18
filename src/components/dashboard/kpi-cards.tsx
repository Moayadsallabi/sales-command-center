"use client";

import { motion } from "framer-motion";
import { AnimatedNumber } from "./animated-number";
import { CallRecord } from "@/lib/types";
import { FunnelStats } from "@/lib/bookings";
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
    /** Buyers who first paid inside this window with no call anywhere. */
    missedCount: number;
    /** What those buyers have paid to date — lifetime, not window. */
    missedWorth: number;
  } | null;
}

export function KPICards({ calls, funnel = null, bank = null, payments = false }: KPICardsProps) {
  const total = calls.length;
  // Which calls count towards a close rate is one rule, shared with every
  // panel below — see carriesClose in lib/money. This card used to spell it
  // out itself, which is how the page ended up with two answers.
  const showed = heldCalls(calls);
  const customers = calls.filter(isWin);
  const closeRate = Math.round(closeRateOf(calls) ?? 0);
  // Every total below is converted into the reporting currency first, so a
  // euro retainer and a dollar sprint can sit in the same number honestly.
  //
  // Revenue counts wins; cash counts money that moved. A deposit taken while
  // booking a follow-up belongs in the second and not the first, which is why
  // the two use different sets rather than both filtering to customers.
  const paying = calls.filter(carriesCash);
  const totalRevenue = calls
    .filter(carriesRevenue)
    .reduce((sum, c) => sum + reportingRevenue(c), 0);
  const totalCashCollected = paying.reduce(
    (sum, c) => sum + reportingCollected(c),
    0
  );

  /**
   * There was a Show Rate tile here. It is gone because it never had an answer
   * to give: with most of the calendar producing no recording either way, the
   * honest figure is a range forty points wide, and a range is not a number
   * anyone can act on. What the calendar can say plainly is how much of it
   * reached this page at all, so that is what sits under Recorded instead.
   */
  const recordedNote =
    funnel && funnel.booked > 0 && funnel.heldRate != null
      ? `${funnel.booked} calls were booked in this window — ${Math.round(
          funnel.heldRate
        )}% of them produced a recording`
      : null;

  /**
   * With Whop connected the tile shows the money that actually moved, and the
   * note names the gap to what the closers logged — worded for whichever way
   * it runs, because off-platform payments can put the tracker AHEAD of the
   * processor. Inside the tolerance the note stays quiet: fees and rounding
   * are not a discrepancy anyone should be sent to chase.
   */
  const cashNote = (() => {
    // WHICH SOURCE THIS NUMBER CAME FROM, ALWAYS SAID.
    //
    // With Whop connected and nothing filtered, this tile shows what the
    // processor banked. The moment any filter narrows the view the processor's
    // figure cannot follow it — Whop knows nothing about closers or outcomes —
    // so the tile falls back to what the closers logged. That is the right
    // fallback and the wrong silence: the number changed source, and for a
    // while it said so only in the case where it did not change.
    //
    // Naming the source in both states means the figure can never move
    // underneath someone for a reason the tile did not state.
    if (bank === null) {
      return payments
        ? "logged by closers — Whop's figure covers the whole business, so it cannot follow a filter"
        : "logged by closers";
    }
    const gap = bank.collected - bank.trackerLogged;
    if (Math.abs(gap) < 50) return "from Whop — matches what closers logged";
    return gap > 0
      ? `from Whop — closers logged ${formatReporting(bank.trackerLogged)}, so ${formatReporting(gap)} has no call behind it`
      : `from Whop — closers logged ${formatReporting(bank.trackerLogged)}, ${formatReporting(-gap)} of that isn't in Whop`;
  })();

  const revenueNote = (() => {
    if (bank === null || bank.missedCount === 0) return null;
    const people = bank.missedCount === 1 ? "1 buyer" : `${bank.missedCount} buyers`;
    return `${people} first paid in this window with no call on the tracker — ${formatReporting(
      bank.missedWorth
    )} so far, none of it in this figure`;
  })();

  const kpis = [
    {
      // Named for what it counts. It has never been the number of calls that
      // were kept — a booking nobody recorded never reached this dashboard.
      label: "Recorded",
      value: total,
      format: "number" as const,
      icon: CalendarCheck,
      accent: false,
      note: recordedNote,
    },
    {
      label: "Calls Taken",
      value: showed.length,
      format: "number" as const,
      icon: PhoneCall,
      accent: false,
      note: null,
    },
    {
      label: "Close Rate",
      value: closeRate,
      format: "percent" as const,
      icon: Target,
      accent: false,
      note: null,
    },
    {
      label: "New Customers",
      value: customers.length,
      format: "number" as const,
      icon: UserPlus,
      accent: false,
      note: null,
    },
    {
      label: "Cash Collected",
      value: bank?.collected ?? totalCashCollected,
      format: "currency" as const,
      icon: Banknote,
      accent: true,
      note: cashNote,
    },
    {
      label: "Revenue",
      value: totalRevenue,
      format: "currency" as const,
      icon: DollarSign,
      accent: true,
      // WHAT THIS FIGURE CANNOT SEE, SAID NEXT TO IT.
      //
      // Revenue only counts calls that were recorded, so a sale made on a call
      // nobody recorded is missing from it with nothing on the page saying so.
      // This is the size of that hole for the window on screen.
      //
      // "so far" is doing real work: the count is people who FIRST paid inside
      // this window, but the amount is everything they have paid to date,
      // because the payment feed carries no buyer and their share of this
      // window cannot be separated out. Better a slightly wide number that
      // says so than a precise-looking one that is wrong.
      note: revenueNote,
    },
  ];

  return (
    // Three across, two rows. Six in one row leaves each card too narrow for a
    // six-figure total, which clips the number the card exists to show.
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-4">
      {kpis.map((kpi, i) => (
        <motion.div
          key={kpi.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08, duration: 0.4, ease: "easeOut" }}
          className={`group relative overflow-hidden rounded-xl border border-white/[0.06] p-4 lg:p-5 transition-all duration-300 hover:border-white/[0.12] ${
            kpi.accent
              ? "bg-gradient-to-br from-gold-500/[0.08] to-transparent glow-gold"
              : "glass-card"
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              {kpi.label}
            </span>
            <kpi.icon
              className={`h-4 w-4 ${
                kpi.accent ? "text-gold-500" : "text-zinc-600"
              }`}
              strokeWidth={1.5}
            />
          </div>
          <AnimatedNumber
            value={kpi.value}
            format={kpi.format}
            className={`font-mono text-2xl lg:text-3xl font-bold tracking-tight tabular-nums ${
              kpi.accent ? "text-gold-400" : "text-zinc-100"
            }`}
          />
          {kpi.note ? (
            <span className="mt-1 block text-[10px] leading-snug text-zinc-500">
              {kpi.note}
            </span>
          ) : null}
        </motion.div>
      ))}
    </div>
  );
}
