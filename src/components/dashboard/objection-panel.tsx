"use client";

import { CallRecord } from "@/lib/types";
import { ObjectionStat, objectionStats } from "@/lib/stats";
import { MessageSquareWarning } from "lucide-react";
import { Panel, PanelHeader } from "./panel";

/**
 * How often each objection comes up, and what the close rate does when it does.
 *
 * The per-call scorecard already says whether an objection was handled well.
 * This says something the call-level view cannot: an objection appearing on
 * half of all calls is being manufactured upstream — by the price, the pitch or
 * the targeting — and drilling closers on handling it treats the symptom. The
 * frequency column is the offer problem; the close-rate column is the cost.
 */
export function ObjectionPanel({
  calls,
  order = 0,
}: {
  calls: CallRecord[];
  order?: number;
}) {
  const result = objectionStats(calls);
  const base = Math.round(result.baseCloseRate);

  return (
    <Panel order={order}>
      <PanelHeader
        icon={MessageSquareWarning}
        title="What people push back on"
        subtitle="Every objection raised, most common first, and what closing did when it came up."
        info={
          <>
            <p>
              The per-call scorecard already says whether an objection was
              handled well. This says something a single call cannot: an
              objection appearing on half of all calls is being manufactured
              upstream — by the price, the pitch or the targeting — and drilling
              closers on handling it treats the symptom.
            </p>
            <p>
              The bar is how often it came up. The figure on the right is the
              close rate on those calls against the close rate across all
              assessed calls, so a negative number is what that objection costs
              when it appears.
            </p>
            <p>
              Under five calls no close rate is shown at all. On numbers that
              small it is a coin toss, and printing it invites acting on one.
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
                before the pattern is worth reading. You have {result.assessed}.
              </>
            ) : (
              <>No objections have been recorded on these calls yet.</>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {result.stats.map((stat) => (
            <ObjectionRow key={stat.name} stat={stat} base={base} />
          ))}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2 text-[11px] text-zinc-400">
            {/* "Reviewed for objections" rather than "assessed" — the lead
                panel uses a stricter test for its own count, and the two
                numbers sitting under the same word looked like a bug. */}
            <span>
              Across {result.assessed}{" "}
              {result.assessed === 1 ? "call" : "calls"} reviewed for objections,
              closing {base}% overall
            </span>
            <span className="ml-auto">
              One call can raise more than one, so these do not add to 100%.
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ObjectionRow({ stat, base }: { stat: ObjectionStat; base: number }) {
  const frequency = Math.round(stat.frequency);
  const rate = Math.round(stat.closeRate);
  const delta = rate - base;

  // Under five calls a close rate is a coin toss, so it is shown greyed with
  // the count rather than stated as a rate anyone should act on.
  const thin = stat.calls < 5;

  const inside = frequency >= 45;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="shrink-0 truncate text-[13px] text-zinc-200 sm:w-[140px] sm:text-zinc-300">
        {stat.name}
        {stat.belief && (
          <span className="ml-1.5 text-[11px] text-zinc-400 sm:ml-0 sm:block">
            {stat.belief} belief
          </span>
        )}
      </span>

      <div className="min-w-0 flex-1">
        {/* The count follows the end of the bar rather than sitting at a fixed
            offset inside the track, so it stays legible on a one-call bar. */}
        <div
          className="relative h-5 rounded bg-white/[0.03]"
          title={`Raised on ${stat.calls} of the assessed calls`}
        >
          <div
            className="absolute inset-y-0 left-0 rounded bg-zinc-500/45"
            style={{ width: `${Math.max(frequency, 1)}%` }}
          />
          <span
            className="absolute inset-y-0 flex items-center justify-end whitespace-nowrap text-[11px] text-zinc-100"
            style={
              inside
                ? { left: 0, width: `${Math.max(frequency, 1)}%`, paddingRight: 8 }
                : { left: `calc(${Math.max(frequency, 1)}% + 8px)` }
            }
          >
            {stat.calls} {stat.calls === 1 ? "call" : "calls"}
          </span>
        </div>
        {stat.decided > 0 && (
          <p className="mt-1 text-[11px] text-zinc-400">
            decided {stat.decided} of them
          </p>
        )}
      </div>

      <span className="flex shrink-0 items-baseline justify-between gap-2 text-right sm:w-[92px] sm:block">
        {thin ? (
          <span
            className="font-mono text-[13px] tabular-nums text-zinc-400"
            title="Under five calls, a close rate is a coin toss"
          >
            too few
          </span>
        ) : (
          <>
            <span className="font-mono text-[15px] tabular-nums text-zinc-200 sm:block sm:text-[13px]">
              {rate}%
            </span>
            <span
              className={`text-[11px] tabular-nums sm:block ${
                delta < 0
                  ? "text-[var(--color-negative)]"
                  : "text-[var(--color-positive)]"
              }`}
              title={`Against ${base}% across all assessed calls`}
            >
              {delta >= 0 ? "+" : ""}
              {delta} vs all
            </span>
          </>
        )}
      </span>
    </div>
  );
}
