"use client";

import { CallRecord } from "@/lib/types";
import { LeadBucket, leadImpact } from "@/lib/stats";
import { LEAD_MAX } from "@/lib/lead-quality";
import { UserSearch } from "lucide-react";
import { Panel, PanelHeader } from "./panel";

/**
 * Close rate on this account's better leads against its worse ones.
 *
 * Everything else on this dashboard measures the closers. This measures what
 * they were given, and it is the panel that decides which conversation to have:
 * a close rate that barely moves between the two halves is a selling problem,
 * and one that swings hard is a traffic problem the closers cannot fix.
 */
export function LeadImpact({
  calls,
  order = 0,
}: {
  calls: CallRecord[];
  order?: number;
}) {
  const result = leadImpact(calls);

  return (
    <Panel order={order}>
      <PanelHeader
        icon={UserSearch}
        title="What the leads are worth"
        subtitle="How often your better half of leads closed, against your worse half."
        info={
          <>
            <p>
              Every prospect is scored out of {LEAD_MAX} on how buyable they
              were when they arrived — pain, urgency, authority, money and the
              rest — separately from how the call was run.
            </p>
            <p>
              This splits your calls at your OWN median rather than a fixed
              threshold, so both halves always have calls in them and the
              comparison holds however good or bad your traffic is.
            </p>
            <p>
              Everything else on this page measures the closers. This measures
              what they were given, and it decides which conversation to have: a
              close rate that barely moves between the halves is a selling
              problem, and one that swings hard is a traffic problem the closers
              cannot fix.
            </p>
          </>
        }
      />

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
          <p className="mt-1.5 text-[11px] text-zinc-400">
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

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-[11px] text-zinc-400">
            {/* Says which calls, not just how many. This count and the
                objection panel's are both "assessed" and are not the same set:
                a lead needs four scored factors to have a score at all, while
                an objection only needs the call to have been reviewed. Two
                different numbers under one word read as an error. */}
            <span>
              {result.assessed} {result.assessed === 1 ? "call" : "calls"} with a
              lead score in this window
            </span>
            <span className="ml-auto">
              Split at your own median, so both halves always have calls in them.
            </span>
          </div>
        </div>
      )}
    </Panel>
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

  const inside = rate >= 45;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="shrink-0 text-[13px] text-zinc-200 sm:w-[140px] sm:text-zinc-300">
        {label}
        <span className="ml-1.5 text-[11px] text-zinc-400 sm:ml-0 sm:block">
          {sub}
        </span>
      </span>

      {/* Both bars run 0–100% of the same width from the same origin, so the
          overhang between them is the gap without anyone doing arithmetic.

          The count used to live inside the fill at whatever width the fill
          happened to be, so on a short bar it spilled onto the dark track in a
          colour chosen for gold. It follows the end of the bar now. */}
      <div className="min-w-0 flex-1">
        <div
          className="relative h-5 rounded bg-white/[0.03]"
          title={`${bucket.closes} of these ${bucket.calls} calls ended as a customer`}
        >
          <div
            className={`absolute inset-y-0 left-0 rounded ${
              tone === "gold" ? "bg-gold-500/80" : "bg-zinc-500/45"
            }`}
            style={{ width: `${Math.max(rate, 1)}%` }}
          />
          <span
            className={`absolute inset-y-0 flex items-center justify-end whitespace-nowrap text-[11px] ${
              inside && tone === "gold"
                ? "font-medium text-[var(--color-gold-ink)]"
                : "text-zinc-100"
            }`}
            style={
              inside
                ? { left: 0, width: `${Math.max(rate, 1)}%`, paddingRight: 8 }
                : { left: `calc(${Math.max(rate, 1)}% + 8px)` }
            }
          >
            {bucket.closes} of {bucket.calls} closed
          </span>
        </div>
      </div>

      <span className="shrink-0 text-right font-mono text-[15px] tabular-nums text-zinc-200 sm:w-11 sm:text-[13px]">
        {rate}%
      </span>
    </div>
  );
}
