"use client";

import { CallRecord } from "@/lib/types";
import {
  DimensionImpact as Impact,
  dimensionImpact,
  roundedGap,
  SWING_WORTH_SAYING,
} from "@/lib/stats";
import { GOOD_SCORE } from "@/lib/dimensions";
import { Coins } from "lucide-react";
import { Panel, PanelHeader } from "./panel";
import { GapLegend, GapRow, GapScale } from "./gap-row";

/**
 * Close rate when each part of the call went well against when it did not,
 * measured on this account's own calls. Everything else on the dashboard
 * asserts that these scores matter; this is the panel that shows it.
 *
 * The rows are dumbbells rather than pairs of bars — see gap-row.tsx for what
 * that changed and why. What lives here is the reading of them: which row is
 * the answer, and whether it is thin enough to need saying out loud.
 */

/** The three columns, declared once so the rows and the axis cannot drift.
    The right column was 132px, which wrapped its one-line note across three
    lines on the narrowest reading it has to carry. */
const GRID = "168px 1fr 150px";

export function DimensionImpact({
  calls,
  order = 0,
}: {
  calls: CallRecord[];
  order?: number;
}) {
  const result = dimensionImpact(calls);
  // Already sorted conclusive-first, widest gap down, by dimensionImpact.
  const best = result.impacts.find((i) => i.conclusive) ?? null;

  return (
    <Panel order={order}>
      <PanelHeader
        icon={Coins}
        title="Which parts of the call move your close rate"
        subtitle="Where your close rate sits when each part went well, against when it did not."
        info={
          <>
            <p>
              Each row splits your scored calls in two — the calls where this
              part scored {GOOD_SCORE} or better, and the calls where it scored
              below {GOOD_SCORE} — then plots how often you closed in each
              group on the same 0–100% axis.
            </p>
            <p>
              The line between the two dots is the gap, so the longest line is
              the part that moves your close rate most. The dot is sized by how
              many calls are behind it: a small dot is a thin sample, however
              far apart the two ends are.
            </p>
            <p>
              A wide gap is a pattern worth drilling, not proof: a strong
              prospect lifts the score and the close together.
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
                before these numbers mean anything. You have {result.scored}.
              </>
            ) : (
              <>
                Not enough spread yet — a comparison needs calls on both sides of
                each score, and right now they are bunched together.
              </>
            )}
          </p>
          <p className="mt-1.5 text-[11px] text-zinc-400">
            Close rates on a handful of calls swing wildly, so this stays hidden
            rather than showing you noise.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <Answer best={best} />

          <div>
            <GapScale gridTemplate={GRID} />
            <div className="space-y-0.5">
              {result.impacts.map((impact) => (
                <ImpactRow key={impact.dimension.key} impact={impact} />
              ))}
            </div>
          </div>

          <GapLegend
            poorLabel={`Scored below ${GOOD_SCORE}`}
            goodLabel={`Scored ${GOOD_SCORE} or better`}
            note="Only parts with enough calls on both sides are shown."
          />
        </div>
      )}
    </Panel>
  );
}

/**
 * THE PANEL'S OWN ANSWER, BEFORE THE EVIDENCE FOR IT.
 *
 * A ranked list makes the reader infer the takeaway from the ordering. Saying
 * it costs one sentence and is the fastest thing on the page. It names the
 * widest conclusive gap, gives both rates so the sentence stands on its own,
 * and — where the row rests on ten calls or fewer — says so in the same breath
 * rather than leaving the caveat to a small figure further right.
 *
 * THE "NOTHING SEPARATES YET" CASE IS A REAL ANSWER, not an empty state. Every
 * part landing inside its own swing means call quality is not what is deciding
 * this period, which is worth reading as plainly as a winner would be. It also
 * replaces the "Too close to call" heading that used to sit mid-list: with the
 * rows drawn dotted, the state is visible on the row itself.
 */
function Answer({ best }: { best: Impact | null }) {
  if (!best) {
    return (
      <p className="max-w-[74ch] border-l-2 border-zinc-700 pl-3.5 t-body text-zinc-300">
        <span className="font-medium text-zinc-100">
          Nothing separates yet.
        </span>{" "}
        Every part below sits inside the swing from a single call landing the
        other way, so none of them is deciding your close rate on this period.
      </p>
    );
  }

  const good = Math.round(best.goodCloseRate);
  const poor = Math.round(best.poorCloseRate);
  const smallest = Math.min(best.goodCalls, best.poorCalls);
  const thin = Math.round(best.swing) >= SWING_WORTH_SAYING;

  return (
    <p className="max-w-[74ch] border-l-2 border-[var(--color-positive)] pl-3.5 t-body text-zinc-300">
      <span className="font-medium text-zinc-100">
        {best.dimension.plainName}
      </span>{" "}
      is the part that moves your close rate most — {good}% of those calls
      closed against {poor}% of the rest.
      {thin && (
        <>
          {" "}
          It rests on{" "}
          <span className="font-medium text-zinc-100">{smallest} calls</span>,
          so treat it as a lead to chase rather than a finding.
        </>
      )}
    </p>
  );
}

function ImpactRow({ impact }: { impact: Impact }) {
  // Rounded once, so the rates the dots sit on and the gap between them always
  // agree — see roundedGap in stats.ts for the fault that rule exists for.
  const good = Math.round(impact.goodCloseRate);
  const poor = Math.round(impact.poorCloseRate);
  const part = impact.dimension.plainName.toLowerCase();

  return (
    <GapRow
      gridTemplate={GRID}
      label={impact.dimension.plainName}
      sublabel={`${impact.goodCalls} vs ${impact.poorCalls} calls`}
      goodRate={good}
      goodCalls={impact.goodCalls}
      poorRate={poor}
      poorCalls={impact.poorCalls}
      gap={roundedGap(impact.goodCloseRate, impact.poorCloseRate)}
      swing={Math.round(impact.swing)}
      conclusive={impact.conclusive}
      title={
        `${impact.goodCloses} of the ${impact.goodCalls} calls where ${part} ` +
        `scored ${GOOD_SCORE} or better closed (${good}%) · ` +
        `${impact.poorCloses} of the ${impact.poorCalls} where it scored below ` +
        `${GOOD_SCORE} closed (${poor}%)`
      }
    />
  );
}
