"use client";

import { motion } from "framer-motion";
import { AnimatedNumber } from "./animated-number";
import { CallRecord } from "@/lib/types";
import { FunnelStats, MIN_COVERAGE_FOR_RATE } from "@/lib/bookings";
import {
  carriesCash,
  carriesRevenue,
  reportingCollected,
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
  /**
   * With a calendar behind it but most of that calendar unaccounted for, there
   * is no honest single figure to show. The rate among the handful of bookings
   * we can trace is not the show rate — on thin coverage it sits near 100%,
   * because the ones we can trace are precisely the ones that produced a
   * recording. So the card goes blank and points at the panel, which carries
   * the range and the reason.
   */
  const tooThin =
    funnel != null &&
    funnel.coverage != null &&
    funnel.coverage < MIN_COVERAGE_FOR_RATE;
  const showRate =
    funnel?.showRate != null ? Math.round(funnel.showRate) : recordedShowRate;
  const customers = calls.filter((c) => c.outcome === "Customer");
  const closeRate = showed.length > 0 ? Math.round((customers.length / showed.length) * 100) : 0;
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
      unavailable: tooThin ? "too much of the calendar unaccounted for" : null,
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
      label: "Cash Collected",
      value: totalCashCollected,
      format: "currency" as const,
      icon: Banknote,
      accent: true,
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
    // Four across, two rows. Eight in one row leaves each card too narrow for
    // a six-figure total, which clips the number the card exists to show.
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
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
          {"unavailable" in kpi && kpi.unavailable ? (
            <>
              <span className="font-mono text-2xl lg:text-3xl font-bold tracking-tight tabular-nums text-zinc-600">
                —
              </span>
              <span className="mt-1 block text-[10px] leading-snug text-zinc-600">
                {kpi.unavailable}
              </span>
            </>
          ) : (
            <AnimatedNumber
              value={kpi.value}
              format={kpi.format}
              className={`font-mono text-2xl lg:text-3xl font-bold tracking-tight tabular-nums ${
                kpi.accent ? "text-gold-400" : "text-zinc-100"
              }`}
            />
          )}
        </motion.div>
      ))}
    </div>
  );
}
