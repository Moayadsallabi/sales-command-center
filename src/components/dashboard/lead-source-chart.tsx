"use client";

import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import { CallRecord } from "@/lib/types";

export function LeadSourceChart({ calls }: { calls: CallRecord[] }) {
  const sources: Record<string, { calls: number; closes: number }> = {};
  calls.forEach((c) => {
    const src = c.lead_source ?? "Unknown";
    if (!sources[src]) sources[src] = { calls: 0, closes: 0 };
    sources[src].calls++;
    if (c.outcome === "Customer") sources[src].closes++;
  });

  const data = Object.entries(sources)
    .map(([name, { calls, closes }]) => ({ name, calls, closes }))
    .sort((a, b) => b.calls - a.calls);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.7, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500 mb-4">
        Lead Source Performance
      </h3>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 0, right: 0, bottom: 0, left: -20 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#ffffff08"
              vertical={false}
            />
            <XAxis
              dataKey="name"
              tick={{ fill: "#71717a", fontSize: 11, fontFamily: "var(--font-bricolage)" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fill: "#52525b", fontSize: 11, fontFamily: "var(--font-jetbrains)" }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: "#18181b",
                border: "1px solid #ffffff15",
                borderRadius: 8,
                fontSize: 12,
                fontFamily: "var(--font-jetbrains)",
              }}
              cursor={{ fill: "#ffffff05" }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 11, fontFamily: "var(--font-bricolage)" }}
            />
            <Bar
              dataKey="calls"
              fill="#3f3f46"
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
              name="Total Calls"
            />
            <Bar
              dataKey="closes"
              fill="#d4af37"
              radius={[4, 4, 0, 0]}
              maxBarSize={32}
              name="Closed"
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
