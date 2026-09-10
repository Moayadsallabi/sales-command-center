"use client";

import { CallRecord, OUTCOME_COLORS, leadQualityScore, overallScore } from "@/lib/types";
// From exclusion-note, not excluded-calls: this is a client component and that
// file reads the list off disk. See the header there.
import { ExclusionKind, exclusionNote } from "@/lib/exclusion-note";
import { leadBandFor } from "@/lib/lead-quality";
import {
  collectedToDate,
  demotedByMoneyRule,
  formatMoney,
  formatReporting,
  revenueCell,
} from "@/lib/money";
import { wasSettledByPayment } from "@/lib/settle";
import { shortDate } from "@/lib/periods";
import { ExternalLink } from "lucide-react";
import { Panel, PanelHeader } from "./panel";
import { callScoreHex, leadScoreHex } from "@/lib/score-tone";

/** One tracker row left out of the dashboard, and why. */
export interface ExcludedNote {
  name: string;
  call_date: string | null;
  reason: string;
  /** Absent means a person ruled on it by hand. See lib/excluded-calls.ts. */
  kind?: ExclusionKind;
}

// The sentence those turn into lives in lib/excluded-calls.ts, beside the rule
// that decides the kinds — and where a test can reach it.

/** One recording the tracker holds more than once, and how many rows it has. */
export interface DuplicateNote {
  name: string;
  call_date: string | null;
  copies: number;
}

export function CallTable({
  calls,
  onSelect,
  excluded = [],
  duplicates = [],
  order = 0,
}: {
  calls: CallRecord[];
  onSelect: (call: CallRecord) => void;
  /**
   * Rows on the tracker that are not this client's business — another offer
   * sold by the same closer, booked into the same calendar. They are named
   * here because the list that holds them is hand-written: it only ever
   * contains what somebody remembered to add, and a count on the page is what
   * makes a stale one noticeable.
   */
  excluded?: ExcludedNote[];
  /**
   * Recordings the tracker holds more than once, collapsed to one row before
   * anything counted them. Named for the same reason as the exclusions above:
   * a filter nobody can see is a filter nobody checks — and unlike the
   * exclusions, this one moves on its own, so a count that starts creeping is
   * the first sign the webhook is being delivered twice more often.
   */
  duplicates?: DuplicateNote[];
  order?: number;
}) {
  const sorted = [...calls].sort((a, b) => {
    if (!a.call_date) return 1;
    if (!b.call_date) return -1;
    return b.call_date.localeCompare(a.call_date);
  });

  return (
    <Panel order={order} padded={false} className="overflow-hidden">
      <div className="p-5 pb-0">
        <PanelHeader
          title="All calls"
          subtitle={[
            "Click a row to open its scorecard.",
            exclusionNote(excluded),
            duplicates.length > 0 &&
              `${duplicates.length} ${
                duplicates.length === 1 ? "recording was" : "recordings were"
              } written to the tracker twice and ${
                duplicates.length === 1 ? "is" : "are"
              } counted once.`,
          ]
            .filter(Boolean)
            .join(" ")}
          right={
            <span className="font-mono text-[13px] tabular-nums text-zinc-400">
              {sorted.length}
            </span>
          }
          info={
            <>
              <p>
                Cash Collected and Revenue are shown in the deal&apos;s own
                currency and are never converted, so a row always matches the
                contract behind it. The totals at the top of the page do convert
                — that is why a euro row can read differently in the two places.
              </p>
              {excluded.length > 0 && (
                <>
                  <p>
                    Left out as another offer&apos;s business, so they reach no
                    number on this page:
                  </p>
                  <ul>
                    {excluded.map((e) => (
                      <li key={`${e.call_date}-${e.name}`}>
                        <strong>{e.name}</strong>
                        {e.call_date ? `, ${e.call_date}` : ""}
                        {e.reason ? ` — ${e.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                  <p>
                    These are named by hand, one at a time, because no column on
                    the tracker says which offer a call was for. The list holds
                    only what somebody added to it, so a row that belongs to the
                    other offer and is not on it still counts here.
                  </p>
                </>
              )}
              <p>
                Lead and Call score are two different questions. The lead is who
                turned up; the call score is how it was run. A blank lead means
                too few factors were assessed to score it, which is not the same
                as a bad prospect.
              </p>
            </>
          }
        />
      </div>
      <div className="scroll-x">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06]">
              {[
                "Name",
                "Closer",
                "Date",
                "Outcome",
                "Cash Collected",
                "Revenue",
                "Source",
                // Two different questions, so both are named rather than one of
                // them owning the word "score": the lead is who turned up, the
                // call is how it was run. A single "Score" column made the
                // second look like the only thing being measured.
                "Lead",
                "Call score",
              ].map((h) => (
                <th
                  key={h}
                  className="t-label sticky top-0 z-10 whitespace-nowrap bg-card px-5 py-3 text-left text-zinc-400"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((call) => (
              <tr
                key={call.id}
                onClick={() => onSelect(call)}
                className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors cursor-pointer"
              >
                <td className="px-5 py-3 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-200">
                      {call.name || "Unknown"}
                    </span>
                    {call.recording_url && (
                      <a
                        href={call.recording_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-zinc-500 transition-colors hover:text-gold-400"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </td>
                <td className="px-5 py-3 whitespace-nowrap text-[13px] text-zinc-400">
                  {call.closer ?? <span className="text-zinc-500">—</span>}
                </td>
                <td className="px-5 py-3 whitespace-nowrap font-mono text-[13px] text-zinc-400 tabular-nums">
                  {call.call_date ? shortDate(call.call_date) : "—"}
                </td>
                <td className="px-5 py-3 whitespace-nowrap">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium"
                    style={{
                      color: OUTCOME_COLORS[call.outcome ?? ""] ?? "#9ca3af",
                      background: `${OUTCOME_COLORS[call.outcome ?? ""] ?? "#9ca3af"}15`,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{
                        background:
                          OUTCOME_COLORS[call.outcome ?? ""] ?? "#9ca3af",
                      }}
                    />
                    {call.outcome ?? "—"}
                  </span>
                  {/* This row is being counted as a win because the processor
                      says it was paid for, not because anyone marked it one.
                      Saying so on the row is the point: a closer whose number
                      moved can see exactly which call moved it, and what the
                      tracker still says. The real fix is correcting the row in
                      Notion, which this does not do. */}
                  {wasSettledByPayment(call) && (
                    <span
                      className="ml-2 whitespace-nowrap text-[11px] text-zinc-400"
                      title={`Recorded as "${call.recorded_outcome}" on the day. Counted as a close because ${formatReporting(call.paid_total ?? 0)} was received. Correct the row in Notion to clear this.`}
                    >
                      was {call.recorded_outcome} · paid
                    </span>
                  )}
                  {/* THE OTHER DIRECTION, AND IT HAD NO MARKER AT ALL.
                      A row typed Customer with nothing banked is not a close
                      [sales-rules.json, a_close_needs_money_to_have_moved], so
                      it is out of revenue, out of the close rate, and on the
                      follow-up list below. The badge still said Customer, in
                      gold, with an empty Cash cell and no explanation — while
                      the follow-ups panel three sections down called the same
                      call open. Two panels, one screen, opposite answers.
                      Found on ABandZz and one nameless row, 2026-09-10. */}
                  {demotedByMoneyRule(call) && (
                    <span
                      className="ml-2 whitespace-nowrap text-[11px] text-amber-300/80"
                      title={`Recorded as "${call.outcome}" on the day, but no money has been received against it, so it is counted as a follow-up rather than a close — not in revenue, not in the close rate. See the follow-up list below.`}
                    >
                      counted as a follow-up · no money in
                    </span>
                  )}
                </td>
                {/* Shown in the deal's own currency — never converted, so the
                    row always matches the contract. */}
                <td className="px-5 py-3 whitespace-nowrap font-mono text-[13px] tabular-nums">
                  {collectedToDate(call) ? (
                    <span className="text-gold-400">
                      {formatMoney(collectedToDate(call), call.currency)}
                      {call.outstanding ? (
                        <span className="ml-1 text-[11px] text-zinc-400">
                          +{formatMoney(call.outstanding, call.currency)}{" "}
                          <span className="font-sans">due</span>
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
                {/* THE FIGURE THE TILE COUNTS, NOT THE ONE THE ROW HAPPENS TO
                    CARRY.
                    carriesRevenue first: every total on this dashboard asks
                    whether the call was won before counting a price, and this
                    column did not, so a call recorded as "No deal" printed the
                    price it was refused at under a heading that says Revenue.
                    Then the amount. This printed `price_closed` alone, and
                    revenue is `max(price_closed, paid_total)` — a call settled
                    by a payment often carries no price at all, so it rendered
                    "—" while contributing to the tile. Live on 2026-09-10 the
                    column summed to $30,000 under a tile reading $30,500, and
                    the missing $500 was one row showing a dash.
                    Shown converted when it is the payment that supplies it:
                    `paid_total` is already in the reporting currency, so
                    printing it beside the row's own currency symbol would label
                    dollars as euros. */}
                <td className="px-5 py-3 whitespace-nowrap font-mono text-[13px] tabular-nums">
                  {(() => {
                    const cell = revenueCell(call);
                    return cell ? (
                      <span className="text-gold-400/50">
                        {formatMoney(cell.amount, cell.currency)}
                      </span>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    );
                  })()}
                </td>
                <td className="px-5 py-3 whitespace-nowrap text-[13px] text-zinc-400">
                  {call.lead_source ?? "—"}
                </td>
                {/* The lead, out of 100. Blank rather than zero when too few
                    factors were assessed to score it — leadQualityScore returns
                    null there, and a 0 would read as a terrible prospect
                    instead of one nobody judged. */}
                <td className="px-5 py-3 whitespace-nowrap">
                  {(() => {
                    const lead = leadQualityScore(call);
                    if (lead == null) return <span className="text-zinc-500">—</span>;
                    return (
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-full transition-[width,background-color] duration-300"
                            style={{
                              width: `${lead}%`,
                              background: leadScoreHex(lead),
                            }}
                          />
                        </div>
                        <span className="font-mono text-[13px] text-zinc-400 tabular-nums">
                          {lead}
                        </span>
                        <span className="text-[11px] text-zinc-400">{leadBandFor(lead)}</span>
                      </div>
                    );
                  })()}
                </td>
                <td className="px-5 py-3 whitespace-nowrap">
                  {/* Computed from the dimension columns, not read from the
                      tracker's Quality Score cell: rows scored before the
                      overall-score floor existed still carry an average over
                      two dimensions there, and this table must agree with the
                      scorecard panel about which calls have an overall. */}
                  {(() => {
                    const overall = overallScore(call);
                    return overall != null ? (
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-[width,background-color] duration-300"
                          style={{
                            width: `${(overall / 10) * 100}%`,
                            // This band started at 8 while every other copy
                            // started at 7.5, so a call scored 7.7 was one
                            // colour on the leaderboard and another here. There
                            // are no copies left: every panel that paints a
                            // score reads score-tone.ts.
                            background: callScoreHex(overall),
                          }}
                        />
                      </div>
                      <span className="font-mono text-[13px] text-zinc-400 tabular-nums">
                        {overall.toFixed(1)}
                      </span>
                    </div>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
