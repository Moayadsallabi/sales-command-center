"use client";

import { motion } from "framer-motion";
import { AnimatedNumber } from "./animated-number";
import { CallRecord } from "@/lib/types";
import { FunnelStats } from "@/lib/bookings";
import {
  reportingCashOnCall,
  reportingCollected,
  reportingOutstanding,
  reportingRevenue,
} from "@/lib/money";
import {
  CalendarCheck,
  CalendarPlus,
  PhoneCall,
  PhoneIncoming,
  Target,
  DollarSign,
  Banknote,
  HandCoins,
  Hourglass,
  UserPlus,
} from "lucide-react";

interface KPICardsProps {
  calls: CallRecord[];
  /** Present only when Calendly is connected. Null falls back to recordings. */
  funnel?: FunnelStats | null;
}

export function KPICards({ calls, funnel = null }: KPICardsProps) {
  const total = calls.length;
  const showed = calls.filter((c) => c.outcome !== "No show");
  /**
   * With no bookings to compare against, the only show rate available divides
   * recordings by recordings — a prospect who cancelled or never appeared left
   * nothing to count, so it reads high by however many of those there were.
   * Connecting Calendly replaces it with the real one.
   */
  const recordedShowRate = total > 0 ? Math.round((showed.length / total) * 100) : 0;
  const showRate =
    funnel?.showRate != null ? Math.round(funnel.showRate) : recordedShowRate;
  const customers = calls.filter((c) => c.outcome === "Customer");
  const closeRate = showed.length > 0 ? Math.round((customers.length / showed.length) * 100) : 0;
  // Every total below is converted into the reporting currency first, so a
  // euro retainer and a dollar sprint can sit in the same number honestly.
  const totalRevenue = customers.reduce((sum, c) => sum + reportingRevenue(c), 0);
  const totalCashCollected = customers.reduce(
    (sum, c) => sum + reportingCollected(c),
    0
  );
  const cashOnCall = customers.reduce((sum, c) => sum + reportingCashOnCall(c), 0);
  const outstanding = customers.reduce((sum, c) => sum + reportingOutstanding(c), 0);

  const kpis = [
    // Only meaningful with a calendar behind it. Without one there is no way
    // to know what was booked, which is exactly the gap this card fills.
    ...(funnel
      ? [
          {
            label: "Booked",
            value: funnel.booked,
            format: "number" as const,
            icon: CalendarPlus,
            accent: false,
          },
        ]
      : []),
    {
      // Named for what it counts. It has never been the number of calls that
      // were kept — a booking nobody recorded never reached this dashboard.
      label: "Recorded",
      value: total,
      format: "number" as const,
      icon: CalendarCheck,
      accent: false,
    },
    {
      label: "Show Rate",
      value: showRate,
      format: "percent" as const,
      icon: PhoneIncoming,
      accent: false,
    },
    {
      label: "Calls Taken",
      value: showed.length,
      format: "number" as const,
      icon: PhoneCall,
      accent: false,
    },
    {
      label: "Close Rate",
      value: closeRate,
      format: "percent" as const,
      icon: Target,
      accent: false,
    },
    {
      label: "New Customers",
      value: customers.length,
      format: "number" as const,
      icon: UserPlus,
      accent: false,
    },
    {
      label: "On the Call",
      value: cashOnCall,
      format: "currency" as const,
      icon: HandCoins,
      accent: false,
    },
    {
      label: "Cash Collected",
      value: totalCashCollected,
      format: "currency" as const,
      icon: Banknote,
      accent: true,
    },
    {
      label: "Outstanding",
      value: outstanding,
      format: "currency" as const,
      icon: Hourglass,
      accent: false,
    },
    {
      label: "Revenue",
      value: totalRevenue,
      format: "currency" as const,
      icon: DollarSign,
      accent: true,
    },
  ];

  return (
    // Five across, two rows. Nine in one row leaves each card too narrow for a
    // six-figure total, which clips the number the card exists to show.
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5 lg:gap-4">
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
        </motion.div>
      ))}
    </div>
  );
}
