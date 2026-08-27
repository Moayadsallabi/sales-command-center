"use client";

import { CallRecord } from "@/lib/types";
import { biggestCosts, MIN_CALLS_PER_CLOSER } from "@/lib/stats";
import { AlertTriangle, TrendingDown, TrendingUp, Users, User } from "lucide-react";
import { Panel, PanelHeader } from "./panel";
import { AMBER, GOLD, NEGATIVE } from "@/lib/palette";
import { GOOD_CALL_SCORE, POOR_SCORE } from "@/lib/stats";

function scoreHex(score: number): string {
  if (score >= GOOD_CALL_SCORE) return GOLD;
  if (score >= POOR_SCORE) return AMBER;
  return NEGATIVE;
}

/**
 * The change since the comparison period, named rather than called "prev".
 *
 * This read "vs last period" until 2026-08-19, which is the one phrasing the
 * rest of the dashboard is written to avoid: with six presets and a custom
 * range on the page there is no way to work out which period that was, and a
 * comparison you cannot name is one you cannot act on.
 */
function Trend({ value, comparisonLabel }: { value: number; comparisonLabel: string }) {
  // Below this it is measurement wobble, not movement.
  if (Math.abs(value) < 0.3) {
    return <span className="text-[11px] text-zinc-400">no change</span>;
  }
  const better = value > 0;
  const Icon = better ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium ${
        better
          ? "text-[var(--color-positive)]"
          : "text-[var(--color-negative)]"
      }`}
    >
      <Icon className="h-3 w-3" strokeWidth={2} />
      {better ? "+" : ""}
      {value.toFixed(1)} {comparisonLabel}
    </span>
  );
}

/**
 * The two dimensions worth acting on, said in plain language. Deliberately not
 * a chart of all eight — when six of them sit at the same number, showing them
 * costs a third of the screen and says nothing.
 */
export function WhatsCostingYou({
  calls,
  previousCalls,
  comparisonLabel,
  closer,
  order = 0,
}: {
  calls: CallRecord[];
  previousCalls: CallRecord[];
  /** What the comparison is against, e.g. "vs 1–19 Jul". */
  comparisonLabel: string;
  closer: string | null;
  order?: number;
}) {
  const costs = biggestCosts(calls, previousCalls);
  const scored = costs[0]?.scored ?? 0;

  return (
    <Panel order={order}>
      <PanelHeader
        icon={AlertTriangle}
        title={closer ? `What is costing ${closer}` : "What is costing you"}
        subtitle="The two parts of the call worth acting on, and whether it is a coaching problem or a script one."
        info={
          <>
            <p>
              Deliberately two rows rather than a chart of all eight. When six
              dimensions sit at the same number, showing them costs a third of
              the screen and says nothing.
            </p>
            <p>
              &ldquo;Whole team&rdquo; means every closer is weak here, so it is
              the script or the training. A named closer means the others handle
              it fine, which is a conversation rather than a rewrite.
            </p>
            <p>
              A closer needs {MIN_CALLS_PER_CLOSER} scored calls before they are
              counted, and any movement smaller than 0.3 reads as no change
              because below that it is measurement wobble.
            </p>
          </>
        }
        right={
          scored > 0 ? (
            <span className="font-mono text-[11px] tabular-nums text-zinc-400">
              from {scored} scored {scored === 1 ? "call" : "calls"}
            </span>
          ) : null
        }
      />

      {costs.length === 0 ? (
        <p className="t-body text-zinc-300">
          {scored === 0
            ? "No scored calls in this range yet."
            : "Nothing is dragging here — every part of the call is scoring 7 or better."}
        </p>
      ) : (
        <div className="space-y-4">
          {costs.map((cost) => (
            <div
              key={cost.dimension.key}
              className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4"
            >
              <div className="flex flex-col-reverse items-start justify-between gap-2 sm:flex-row sm:gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <h4 className="text-[15px] font-medium text-zinc-100">
                      {cost.dimension.plainName}
                    </h4>
                    {cost.scope !== "unknown" && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                          cost.scope === "team"
                            ? "border-amber-500/25 bg-amber-500/[0.08] text-amber-300"
                            : "border-white/[0.08] bg-white/[0.03] text-zinc-400"
                        }`}
                      >
                        {cost.scope === "team" ? (
                          <>
                            <Users className="h-2.5 w-2.5" strokeWidth={2} />
                            Whole team
                          </>
                        ) : (
                          <>
                            <User className="h-2.5 w-2.5" strokeWidth={2} />
                            {cost.closers.join(", ")}
                          </>
                        )}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] text-zinc-400">
                    {cost.dimension.plainQuestion}
                  </p>
                </div>
                <div className="flex shrink-0 items-baseline gap-3 text-right sm:block">
                  <div
                    className="font-mono text-2xl font-bold tabular-nums"
                    style={{ color: scoreHex(cost.average) }}
                  >
                    {cost.average.toFixed(1)}
                  </div>
                  {cost.trend != null && (
                    <Trend value={cost.trend} comparisonLabel={comparisonLabel} />
                  )}
                </div>
              </div>

              <div className="mt-3 space-y-1.5 border-t border-white/[0.05] pt-3">
                <p className="text-[13px] text-zinc-300">
                  Went wrong on{" "}
                  <span className="font-medium text-zinc-100">
                    {cost.callsPoor} of {cost.scored}
                  </span>{" "}
                  calls.
                </p>
                {cost.gap != null && cost.gap > 0 && (
                  <p className="text-[13px] text-zinc-300">
                    Calls where this went well closed{" "}
                    <span className="font-medium text-gold-400">
                      {Math.round(cost.gap)} points
                    </span>{" "}
                    more often than calls where it did not.
                  </p>
                )}
                {cost.scope === "team" && (
                  <p className="flex items-start gap-1.5 pt-1 text-[13px] text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.5} />
                    Every closer is weak here, so this is the script or the training —
                    not one person to coach.
                  </p>
                )}
                {cost.scope === "individual" && cost.closers.length > 0 && (
                  <p className="pt-1 text-[13px] text-zinc-400">
                    Others on the team handle this fine, so it is a coaching
                    conversation rather than a script change.
                  </p>
                )}
              </div>
            </div>
          ))}

          {!closer && (
            <p className="text-[11px] text-zinc-400">
              A closer needs {MIN_CALLS_PER_CLOSER} scored calls before they are
              counted here.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
