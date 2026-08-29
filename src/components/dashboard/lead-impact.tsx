"use client";

import { CallRecord } from "@/lib/types";
import { leadImpact, roundedGap } from "@/lib/stats";
import { LEAD_MAX } from "@/lib/lead-quality";
import { UserSearch } from "lucide-react";
import { Panel, PanelHeader } from "./panel";
import { GapRow, GapScale } from "./gap-row";

/**
 * Close rate on this account's better leads against its worse ones.
 *
 * Everything else on this dashboard measures the closers. This measures what
 * they were given, and it is the panel that decides which conversation to have:
 * a close rate that barely moves between the two halves is a selling problem,
 * and one that swings hard is a traffic problem the closers cannot fix.
 *
 * TWO NUMBERS, SAID BEFORE THEY ARE DRAWN. This panel spent a full card on a
 * comparison with exactly two figures in it: two full-width bars, a paragraph
 * restating them, and two footnotes. The finding now leads, in one sentence
 * carrying both rates and the distance between them, and the row below is the
 * same comparison as the panel above it draws — one axis, two dots, a line
 * whose length is the gap. See gap-row.tsx.
 */

/** Matches the parts-of-the-call panel, so the two read as one idea. */
const GRID = "168px 1fr 132px";

export function LeadImpact({
  calls,
  order = 0,
}: {
  calls: CallRecord[];
  order?: number;
}) {
  const result = leadImpact(calls);

  /**
   * ROUNDED ONCE, SO THE NUMBERS ON SCREEN AGREE.
   *
   * The rates the dots sit on and the gap stated in the sentence are two
   * roundings of one comparison: 83.33% against 28.57% rendered as "83%",
   * "29%" and "55 points", and 83 minus 29 is 54. `result.conclusive` is
   * deliberately left on the raw numbers — whether a gap clears the swing from
   * a single call is a judgement about the real figures, not the printed ones.
   */
  const betterRate = Math.round(result.better.closeRate);
  const worseRate = Math.round(result.worse.closeRate);
  const shownGap = roundedGap(result.better.closeRate, result.worse.closeRate);
  const swing = Math.round(result.swing);

  return (
    <Panel order={order}>
      <PanelHeader
        icon={UserSearch}
        title="What the leads are worth"
        subtitle="Where your close rate sits on your better half of leads, against your worse half."
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
          <p className="max-w-[74ch] t-body text-zinc-300">
            Your better half of leads closed{" "}
            <span className="font-medium text-zinc-100">{betterRate}%</span> of
            the time. Your worse half closed{" "}
            <span className="font-medium text-zinc-100">{worseRate}%</span>
            {result.conclusive ? (
              <>
                {" "}
                — a gap of{" "}
                <span className="font-medium text-[var(--color-positive)]">
                  {Math.abs(shownGap)} points
                </span>
                .{" "}
                {shownGap >= 0 ? (
                  <>
                    That gap is the ceiling on what better coaching alone can buy
                    you; the rest is upstream, in who is booking calls.
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
                {" "}
                — {Math.abs(shownGap)} points apart, which one call landing the
                other way would erase. On this window, lead quality is not what
                is deciding your close rate, so the room to improve is on the
                calls themselves.
              </>
            )}
          </p>

          <div>
            <GapScale gridTemplate={GRID} />
            <GapRow
              gridTemplate={GRID}
              label="Better against worse"
              sublabel={`split at ${result.splitAt}/${LEAD_MAX}`}
              goodRate={betterRate}
              goodCalls={result.better.calls}
              poorRate={worseRate}
              poorCalls={result.worse.calls}
              gap={shownGap}
              swing={swing}
              conclusive={result.conclusive}
              title={
                `${result.better.closes} of the ${result.better.calls} leads scoring ` +
                `above ${result.splitAt} closed (${betterRate}%) · ` +
                `${result.worse.closes} of the ${result.worse.calls} scoring ` +
                `${result.splitAt} or below closed (${worseRate}%)`
              }
            />
          </div>

          {/* Says which calls, not just how many. This count and the objection
              panel's are both "assessed" and are not the same set: a lead needs
              four scored factors to have a score at all, while an objection only
              needs the call to have been reviewed. Two different numbers under
              one word read as an error. */}
          <p className="pt-1 text-[11px] text-zinc-400">
            {result.assessed} {result.assessed === 1 ? "call has" : "calls have"}{" "}
            a lead score in this window, split at your own median so both halves
            always have calls in them.
          </p>
        </div>
      )}
    </Panel>
  );
}
