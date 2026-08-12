"use client";

import { motion } from "framer-motion";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  ZAxis,
} from "recharts";
import { CallRecord, OUTCOME_COLORS } from "@/lib/types";

export function QualityChart({ calls }: { calls: CallRecord[] }) {
  const withQuality = calls.filter(
    (c) => c.call_date && c.quality_score != null
  );

  const avgQuality =
    withQuality.length > 0
      ? withQuality.reduce((s, c) => s + (c.quality_score ?? 0), 0) /
        withQuality.length
      : 0;

  // Group by outcome for different colors
  const outcomes = [...new Set(withQuality.map((c) => c.outcome))];
  const grouped = outcomes.map((outcome) => ({
    outcome,
    data: withQuality
      .filter((c) => c.outcome === outcome)
      .map((c) => ({
        date: new Date(c.call_date! + "T00:00:00").getTime(),
        quality: c.quality_score,
        name: c.name,
        outcome: c.outcome,
        z: 120,
      })),
  }));

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.9, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          Overall Score Over Time
        </h3>
        <span className="font-mono text-xs text-zinc-500 tabular-nums">
          avg {avgQuality.toFixed(1)}
        </span>
      </div>
      <div className="h-[280px]">
        {withQuality.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#ffffff08"
              />
              <XAxis
                type="number"
                dataKey="date"
                domain={["dataMin", "dataMax"]}
                tick={{ fill: "#71717a", fontSize: 11, fontFamily: "var(--font-bricolage)" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) =>
                  new Date(v).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }
              />
              <YAxis
                type="number"
                dataKey="quality"
                domain={[0, 10]}
                tick={{ fill: "#52525b", fontSize: 11, fontFamily: "var(--font-jetbrains)" }}
                tickLine={false}
                axisLine={false}
              />
              <ZAxis type="number" dataKey="z" range={[80, 80]} />
              <ReferenceLine
                y={avgQuality}
                stroke="#ffffff20"
                strokeDasharray="6 4"
                label={{
                  value: `Avg: ${avgQuality.toFixed(1)}`,
                  fill: "#52525b",
                  fontSize: 10,
                  fontFamily: "var(--font-jetbrains)",
                  position: "right",
                }}
              />
              <Tooltip
                contentStyle={{
                  background: "#18181b",
                  border: "1px solid #ffffff15",
                  borderRadius: 8,
                  fontSize: 12,
                  fontFamily: "var(--font-jetbrains)",
                }}
                formatter={(value, name) => {
                  if (name === "quality") return [String(value), "Quality"];
                  return [String(value), String(name)];
                }}
                labelFormatter={(v) =>
                  new Date(v).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                }
              />
              {grouped.map((g) => (
                <Scatter
                  key={g.outcome}
                  name={g.outcome ?? "Unknown"}
                  data={g.data}
                  fill={OUTCOME_COLORS[g.outcome ?? ""] ?? "#6b7280"}
                  opacity={0.85}
                />
              ))}
            </ScatterChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-600 text-sm">
            No quality data
          </div>
        )}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
        {grouped.map((g) => (
          <div key={g.outcome} className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{
                background: OUTCOME_COLORS[g.outcome ?? ""] ?? "#6b7280",
              }}
            />
            <span className="text-[10px] text-zinc-500">{g.outcome}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
