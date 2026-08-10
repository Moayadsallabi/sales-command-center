"use client";

import { motion } from "framer-motion";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { CallRecord } from "@/lib/types";

export function RevenueChart({ calls }: { calls: CallRecord[] }) {
  const customers = calls
    .filter((c) => c.outcome === "Customer" && c.call_date && c.price_closed)
    .sort((a, b) => a.call_date!.localeCompare(b.call_date!));

  const byDate: Record<string, number> = {};
  customers.forEach((c) => {
    const d = c.call_date!;
    byDate[d] = (byDate[d] ?? 0) + (c.price_closed ?? 0);
  });

  let cumulative = 0;
  const data = Object.entries(byDate).map(([date, rev]) => {
    cumulative += rev;
    return {
      date: new Date(date + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      revenue: rev,
      cumulative,
    };
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.6, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500 mb-4">
        Revenue Over Time
      </h3>
      <div className="h-[260px]">
        {data.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={data}
              margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#ffffff08"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fill: "#71717a", fontSize: 11, fontFamily: "var(--font-bricolage)" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fill: "#52525b", fontSize: 11, fontFamily: "var(--font-jetbrains)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: "#18181b",
                  border: "1px solid #ffffff15",
                  borderRadius: 8,
                  fontSize: 12,
                  fontFamily: "var(--font-jetbrains)",
                }}
                formatter={(value) => [
                  `$${Number(value).toLocaleString()}`,
                  undefined,
                ]}
                cursor={{ fill: "#ffffff05" }}
              />
              <Bar
                dataKey="revenue"
                fill="#d4af3730"
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
                name="Per Deal"
              />
              <Line
                type="monotone"
                dataKey="cumulative"
                stroke="#d4af37"
                strokeWidth={2.5}
                dot={{ fill: "#d4af37", r: 4, strokeWidth: 0 }}
                activeDot={{ fill: "#d4af37", r: 6, strokeWidth: 2, stroke: "#09090b" }}
                name="Cumulative"
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            No closed deals yet
          </div>
        )}
      </div>
    </motion.div>
  );
}
