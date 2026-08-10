"use client";

import { motion } from "framer-motion";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Cell,
  Tooltip,
} from "recharts";
import { CallRecord, OUTCOME_COLORS } from "@/lib/types";

export function OutcomeChart({ calls }: { calls: CallRecord[] }) {
  const counts: Record<string, number> = {};
  calls.forEach((c) => {
    if (c.outcome) counts[c.outcome] = (counts[c.outcome] ?? 0) + 1;
  });

  const data = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500 mb-4">
        Outcomes
      </h3>
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
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
            <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={48}>
              {data.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={OUTCOME_COLORS[entry.name] ?? "#6b7280"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.div>
  );
}
