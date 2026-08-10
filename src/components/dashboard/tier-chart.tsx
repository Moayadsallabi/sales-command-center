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

export function TierChart({ calls }: { calls: CallRecord[] }) {
  const tiers: Record<string, number> = {};
  calls.forEach((c) => {
    if (c.tier) tiers[c.tier] = (tiers[c.tier] ?? 0) + 1;
  });

  const data = Object.entries(tiers).map(([name, value]) => ({
    name,
    value,
  }));

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.8, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500 mb-4">
        Tier Distribution
      </h3>
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
                      <span className="text-zinc-600 font-normal">
                        ({Math.round((d.value / total) * 100)}%)
                      </span>
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
