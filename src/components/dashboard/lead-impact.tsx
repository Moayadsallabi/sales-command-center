"use client";

import { motion } from "framer-motion";
import { CallRecord } from "@/lib/types";
import { LeadBucket, leadImpact } from "@/lib/stats";
import { LEAD_MAX } from "@/lib/lead-quality";
import { UserSearch } from "lucide-react";

/**
 * Close rate on this account's better leads against its worse ones.
 *
 * Everything else on this dashboard measures the closers. This measures what
 * they were given, and it is the panel that decides which conversation to have:
 * a close rate that barely moves between the two halves is a selling problem,
 * and one that swings hard is a traffic problem the closers cannot fix.
 */
export function LeadImpact({ calls }: { calls: CallRecord[] }) {
  const result = leadImpact(calls);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.75, duration: 0.4 }}
      className="rounded-xl border border-white/[0.06] glass-card p-5"
    >
      <div className="mb-1 flex items-center gap-2">
        <UserSearch className="h-3.5 w-3.5 text-gold-500" strokeWidth={1.5} />
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          What the leads are worth
        </h3>
      </div>
      <p className="mb-5 max-w-[70ch] text-[12px] leading-relaxed text-zinc-600">
        Every prospect is scored out of {LEAD_MAX} on how buyable they were when
        they arrived — pain, urgency, authority, money and the rest — separately
        from how the call was run. This splits your calls at your own median and
        shows how often each half closed.
      </p>

      {!result.ready ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
          <p className="text-[13px] text-zinc-400">
            {result.callsShort > 0 ? (
              <>
                Needs{" "}
                <span className="font-medium text-zinc-200">
                  {result.callsShort} more scored{" "}
                  {result.callsShort === 1 ? "call" : "calls"}
                </span>{" "}
                before this means anything. You have {result.assessed} with a lead
                score behind them.
              </>
            ) : (
              <>
                Your leads are all scoring within a few points of each other, so
                there are not two halves to compare yet.
              </>
            )}
          </p>
          <p className="mt-1.5 text-[11px] text-zinc-600">
            Calls scored before lead quality was added do not count here — they
            were never assessed, which is different from scoring badly.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="space-y-2">
            <Row
              label="Better half"
              sub={`above ${result.splitAt}/${LEAD_MAX}`}
              bucket={result.better}
              tone="gold"
            />
            <Row
              label="Worse half"
              sub={`${result.splitAt}/${LEAD_MAX} and below`}
              bucket={result.worse}
              tone="grey"
            />
          </div>

          <p className="max-w-[70ch] text-[12px] leading-relaxed text-zinc-400">
            {result.conclusive ? (
              <>
                Your better leads close{" "}
                <span className="font-medium text-gold-300">
                  {Math.abs(Math.round(result.gap))} points
                </span>{" "}
                {result.gap >= 0 ? "more often" : "less often"} than your worse
                ones.{" "}
                {result.gap >= 0 ? (
                  <>
                    That gap is the ceiling on what better coaching alone can buy
                    you — the rest is upstream, in who is booking calls.
                  </>
                ) : (
                  <>
                    That is backwards, and worth looking at directly: either the
                    lead scoring is misreading your market, or your closers are
                    handling weak prospects better than strong ones.
                  </>
                )}
              </>
            ) : (
              <>
                The two halves are within{" "}
                <span className="font-medium text-zinc-200">
                  {Math.abs(Math.round(result.gap))} points
                </span>{" "}
                of each other, which one call landing the other way would erase.
                On this window, lead quality is not what is deciding your close
                rate — so the room to improve is on the calls themselves.
              </>
            )}
          </p>

          <div className="flex items-center gap-4 pt-1 text-[10px] text-zinc-600">
            <span>
              {result.assessed} assessed{" "}
              {result.assessed === 1 ? "call" : "calls"} in this window
            </span>
            <span className="ml-auto">
              Split at your own median, so both halves always have calls in them.
            </span>
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Row({
  label,
  sub,
  bucket,
  tone,
}: {
  label: string;
  sub: string;
  bucket: LeadBucket;
  tone: "gold" | "grey";
}) {
  const rate = Math.round(bucket.closeRate);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5">
      <span className="w-[140px] shrink-0 text-[13px] text-zinc-300">
        {label}
        <span className="block text-[11px] text-zinc-600">{sub}</span>
      </span>

      {/* Both bars run 0–100% of the same width from the same origin, so the
          overhang between them is the gap without anyone doing arithmetic. */}
      <div className="flex-1">
        <div className="h-5 overflow-hidden rounded bg-white/[0.03]">
          <div
            className={`flex h-full items-center rounded ${
              tone === "gold" ? "bg-gold-500/70" : "bg-zinc-600/60"
            }`}
            style={{ width: `${Math.max(rate, 1)}%` }}
          >
            <span
              className={`whitespace-nowrap pl-2 text-[10px] ${
                tone === "gold" ? "text-gold-100/80" : "text-zinc-300/80"
              }`}
              title={`${bucket.closes} of these ${bucket.calls} calls ended as a customer`}
            >
              {bucket.closes} of {bucket.calls} closed
            </span>
          </div>
        </div>
      </div>

      <span className="w-11 shrink-0 text-right font-mono text-[13px] tabular-nums text-zinc-300">
        {rate}%
      </span>
    </div>
  );
}
