"use client";

import { motion } from "framer-motion";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { CallRecord } from "@/lib/types";

const TIER_COLORS: Record<string, string> = {
  "Tier 1": "#6366f1",
  "Tier 2": "#a855f7",
};

/**
 * Whole percentages that always total 100.
 *
 * Rounding each share on its own is what produced a two-slice pie labelled
 * 88% and 13%. Largest remainder gives every slice its floor, then hands the
 * leftover points to whichever slices were rounded down hardest.
 */
function wholePercentages(values: number[]): number[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0) return values.map(() => 0);

  const exact = values.map((v) => (v / total) * 100);
  const floors = exact.map(Math.floor);
  let left = 100 - floors.reduce((s, v) => s + v, 0);

  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);

  const out = [...floors];
  for (const { index } of order) {
    if (left <= 0) break;
    out[index] += 1;
    left -= 1;
  }
  return out;
}

export function TierChart({ calls }: { calls: CallRecord[] }) {
  const tiers: Record<string, number> = {};
  calls.forEach((c) => {
    if (c.tier) tiers[c.tier] = (tiers[c.tier] ?? 0) + 1;
  });

  const entries = Object.entries(tiers);
  const shares = wholePercentages(entries.map(([, value]) => value));
  const data = entries.map(([name, value], i) => ({
    name,
    value,
    share: shares[i],
  }));

  const total = data.reduce((s, d) => s + d.value, 0);
  // Rows the scorer never assigned a tier to. Left out of the chart, so the
  // count is said out loud rather than leaving the pie claiming to cover
  // every call in the window.
  const untiered = calls.length - total;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500 mb-1">
        Tier Distribution
      </h3>
      <p className="mb-4 text-[10px] text-zinc-600">
        {untiered > 0
          ? `${total} of ${calls.length} calls have a tier — the other ${untiered} are not counted here.`
          : `All ${total} calls in this window.`}
      </p>
      <div className="h-[260px] flex items-center">
        {data.length > 0 ? (
          <div className="flex items-center w-full gap-4">
            <div className="flex-1 h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={85}
                    paddingAngle={4}
                    dataKey="value"
                    stroke="none"
                  >
                    {data.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={TIER_COLORS[entry.name] ?? "#6b7280"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "#18181b",
                      border: "1px solid #ffffff15",
                      borderRadius: 8,
                      fontSize: 12,
                      fontFamily: "var(--font-jetbrains)",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-3 pr-2">
              {data.map((d) => (
                <div key={d.name} className="flex items-center gap-3">
                  <div
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ background: TIER_COLORS[d.name] ?? "#6b7280" }}
                  />
                  <div>
                    <div className="text-xs text-zinc-400">{d.name}</div>
                    <div className="font-mono text-sm font-semibold text-zinc-200 tabular-nums">
                      {d.value}{" "}
                      <span className="text-zinc-600 font-normal">({d.share}%)</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center w-full text-zinc-600 text-sm">
            No tier data
          </div>
        )}
      </div>
    </motion.div>
  );
}
