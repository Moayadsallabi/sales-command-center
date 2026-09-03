"use client";

import { CallRecord } from "@/lib/types";
import { MatchedPayment } from "@/lib/reconcile";
import {
  collectable,
  COLLECT_QUIET_DAYS,
  COLLECT_COLD_DAYS,
} from "@/lib/collect";
import { formatReporting } from "@/lib/money";
import { HandCoins, ExternalLink } from "lucide-react";
import { Panel, PanelHeader } from "./panel";

/** How many rows before the list stops being a list and becomes a wall. */
const SHOWN = 15;

/**
 * The money that is owed, as people to ring rather than as a total.
 *
 * The second panel on this page that is a job rather than a number. Cash
 * collected says how much arrived and Revenue says what was sold; the gap
 * between them is a payment plan halfway through, and until this existed there
 * was nothing on the page that turned that gap into a name.
 *
 * ORDERED BY SILENCE, NOT BY LATENESS, because the tracker holds no date a
 * payment is due — see lib/collect.ts. The subtitle says so in the same
 * sentence as the number, rather than leaving "40d quiet" to be read as
 * "40 days late", which is a different and much stronger claim.
 */
export function PaymentsToCollect({
  calls,
  matched,
  today,
  order = 0,
}: {
  /** Every call, unfiltered — see the note in the footer. */
  calls: CallRecord[];
  /** reconcile's matches, unwindowed. Empty when the processor is not connected. */
  matched: MatchedPayment[];
  today: string;
  order?: number;
}) {
  const result = collectable(calls, matched, today);
  const shown = result.items.slice(0, SHOWN);
  const rest = result.items.slice(SHOWN);
  const restOwed = rest.reduce((sum, i) => sum + i.owed, 0);
  const none = result.items.length === 0;

  /* A PANEL THAT CANNOT FILL IS NOT DRAWN — but this one can, and an empty one
     is the good news that every closed deal has been paid for. It is drawn
     whenever there is anything at all to say, including when the only thing to
     say is that some deals carry no price and therefore cannot be checked. */
  if (none && result.unpriced === 0) return null;

  return (
    <Panel order={order}>
      <PanelHeader
        icon={HandCoins}
        title="Payments to collect"
        subtitle={
          none
            ? undefined
            : `${result.items.length} closed ${
                result.items.length === 1 ? "deal is" : "deals are"
              } part paid${
                /* "QUIET", NOT "HAD NOTHING". Half of these rows are counted
                   from the call rather than from a payment, because no payment
                   could be dated — so "had nothing for 30 days" is a claim the
                   data cannot always support, while "quiet" is the word this
                   panel defines and every row can carry. */
                result.quiet > 0
                  ? `, and ${
                      result.quiet === 1 ? "one has" : `${result.quiet} have`
                    } been quiet for over ${COLLECT_QUIET_DAYS} days`
                  : ""
              }.`
        }
        right={
          none ? null : (
            <span className="font-mono text-[13px] tabular-nums text-gold-300">
              {formatReporting(result.owed)}{" "}
              {/* A REAL SPACE, NOT A MARGIN — `ml-1.5` leaves none in the text
                  itself, so a screen reader and anyone copying the line both
                  get "$27,000owed". This page has shipped that defect twice. */}
              <span className="text-[11px] font-sans text-zinc-400">owed</span>
            </span>
          )
        }
        info={
          <>
            <p>
              What was agreed on the call, minus what has actually arrived. The
              money comes from the payment processor wherever a payment could be
              tied to the call, because Cash Collected on the tracker is typed
              by hand and drifts low — a later instalment lands and nobody goes
              back to the row, which is this list exactly. A row the processor
              could not be matched to says <em>from the tracker</em>, and that
              figure is somebody&apos;s typing rather than the bank.
            </p>
            <p>
              <strong>Nothing here says a payment is late.</strong> The tracker
              has no column for when the next one falls due, and a plan agreed
              out loud usually has no such date written down anywhere, so
              guessing one would chase customers who are paying to schedule.
              What each row shows is how long since money last arrived. Where
              no payment could be matched the tracker gives an amount and no
              date to go with it, so the row says <em>no date</em> and the
              silence is counted from the call instead — the best marker
              available, and a weaker one. Over{" "}
              {COLLECT_QUIET_DAYS} days is worth a message and over{" "}
              {COLLECT_COLD_DAYS} is worth worrying about; both are judgement,
              not a deadline anyone agreed to.
            </p>
            {result.uncheckable > 0 && (
              <p>
                {result.uncheckable}{" "}
                {result.uncheckable === 1 ? "row carries" : "rows carry"} no
                prospect email, so no payment could be looked for and the figure
                is the tracker&apos;s own. Open{" "}
                {result.uncheckable === 1 ? "it" : "them"} before ringing: a
                deal written up twice looks exactly like this, and the second
                copy reads as a customer who never paid. Putting the address on
                the row in Notion is what makes the money check itself.
              </p>
            )}
            {result.unpriced > 0 && (
              <p>
                {result.unpriced}{" "}
                {result.unpriced === 1
                  ? "closed deal carries no price, so nothing can say whether it owes"
                  : "closed deals carry no price, so nothing can say whether they owe"}{" "}
                anything. They cannot appear above at any amount. Put the price
                on the row in Notion and they will.
              </p>
            )}
            <p>The date range at the top of the page does not apply here.</p>
          </>
        }
      />

      {none ? (
        <p className="max-w-[80ch] t-body text-zinc-300">
          Every closed deal with a price on it has been paid in full.
        </p>
      ) : (
        <>
          {/* Named columns, hidden below `sm` where the rows stack and each
              value carries its own label instead — the same shape as the
              follow-up list above, because it is the same kind of list. */}
          <div className="hidden gap-x-3 px-3.5 pb-1.5 sm:grid sm:grid-cols-[86px_minmax(0,1fr)_110px_120px_12px]">
            <span className="t-label text-zinc-500">Last paid</span>
            <span className="t-label text-zinc-500">Prospect</span>
            <span className="t-label text-zinc-500">Closer</span>
            <span className="t-label text-right text-zinc-500">Still owed</span>
            <span />
          </div>

          <div className="space-y-1">
            {shown.map((item) => (
              <a
                key={item.call.id}
                href={item.call.notion_url}
                target="_blank"
                rel="noopener noreferrer"
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5 transition-colors hover:border-white/[0.12] hover:bg-white/[0.03] sm:grid-cols-[86px_minmax(0,1fr)_110px_120px_12px]"
              >
                <span className="col-span-3 min-w-0 truncate text-[15px] font-medium text-zinc-100 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:text-[13px] sm:font-normal sm:text-zinc-200">
                  {item.call.name || "Unknown"}
                </span>
                {/* THREE STATES, BECAUSE TWO OF THEM HAVE NO DATE FOR OPPOSITE
                    REASONS. A dated payment prints the days since it. A row
                    the processor could not be matched to has money on it and
                    no date beside that money — the tracker's Cash Collected is
                    a running total — so it says the date is missing rather
                    than borrowing the call's and printing it under a heading
                    that says Last paid. Only a deal nothing has ever been paid
                    against says nothing yet. Drawn the same way, the first
                    demo row read "Nothing yet" beside "$1,125 of $4,500", which
                    is the row contradicting itself. */}
                <span
                  className={`whitespace-nowrap font-mono text-[13px] tabular-nums sm:col-start-1 sm:row-start-1 ${
                    item.quiet >= COLLECT_COLD_DAYS
                      ? "text-[var(--color-negative)]"
                      : item.quiet >= COLLECT_QUIET_DAYS
                      ? "text-amber-400"
                      : "text-zinc-300"
                  }`}
                  title={
                    item.lastPaid
                      ? `Last payment ${item.lastPaid}. ${
                          item.payments === 1
                            ? "One payment"
                            : `${item.payments} payments`
                        } received, ${formatReporting(item.paid)} in all.`
                      : item.paid > 0
                      ? `${formatReporting(
                          item.paid
                        )} has been collected and the tracker does not record when. Counted from the call, ${
                          item.quiet
                        } days ago.`
                      : `Nothing has been received against this deal. ${item.quiet} days since the call.`
                  }
                >
                  {item.lastPaid
                    ? `${item.quiet}d ago`
                    : item.paid > 0
                    ? "No date"
                    : "Nothing yet"}
                </span>
                <span className="min-w-0 truncate text-[13px] text-zinc-400 sm:col-start-3 sm:row-start-1">
                  {item.call.closer ?? "—"}
                </span>
                <span className="text-right font-mono text-[13px] tabular-nums text-gold-300 sm:col-start-4 sm:row-start-1">
                  {formatReporting(item.owed)}{" "}
                  <span className="text-[11px] text-zinc-400">
                    of {formatReporting(item.price)}
                  </span>
                  {item.source === "tracker" && (
                    <span className="block text-[11px] font-sans text-zinc-500">
                      from the tracker
                    </span>
                  )}
                </span>
                <ExternalLink className="hidden h-3 w-3 text-zinc-500 sm:col-start-5 sm:row-start-1 sm:block" />
              </a>
            ))}
          </div>

          {/* Never a silent cut. A worklist that quietly stops at fifteen reads
              as a worklist of fifteen. */}
          {rest.length > 0 && (
            <p className="mt-2 text-[11px] text-zinc-400">
              {rest.length} more, {formatReporting(restOwed)} owed between them,
              all quieter for less time than these — open the tracker to work
              the rest.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
