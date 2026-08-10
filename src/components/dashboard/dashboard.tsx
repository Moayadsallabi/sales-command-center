"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { CallRecord, OUTCOMES } from "@/lib/types";
import { KPICards } from "./kpi-cards";
import { OutcomeChart } from "./outcome-chart";
import { RevenueChart } from "./revenue-chart";
import { LeadSourceChart } from "./lead-source-chart";
import { TierChart } from "./tier-chart";
import { QualityChart } from "./quality-chart";
import { CallTable } from "./call-table";
import { LiveIndicator } from "./live-indicator";
import { Activity, Filter, X } from "lucide-react";

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
}: {
  calls: CallRecord[];
  today: string;
}) {
  const [dateRange, setDateRange] = useState<DateRange>("30d");
  const [selectedOutcomes, setSelectedOutcomes] = useState<Set<string>>(
    new Set()
  );
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set()
  );

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

  const hasFilters = selectedOutcomes.size > 0 || selectedSources.size > 0;

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
              <Activity className="w-4 h-4 text-gold-500" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-zinc-100">
                Sales Command Center
              </h1>
              <p className="text-[11px] text-zinc-600">
                {filtered.length} of {calls.length} calls
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
              }}
              className="flex items-center gap-1 px-2 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        <KPICards calls={filtered} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <OutcomeChart calls={filtered} />
          <RevenueChart calls={filtered} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LeadSourceChart calls={filtered} />
          <TierChart calls={filtered} />
        </div>

        <QualityChart calls={filtered} />
        <CallTable calls={filtered} />
      </main>

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
