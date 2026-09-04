"use client";

import { CallRecord } from "@/lib/types";
import { followUps, FOLLOW_UP_COLD_DAYS, FOLLOW_UP_STALE_DAYS } from "@/lib/follow-ups";
import { formatMoney, formatReporting } from "@/lib/money";
import { PhoneForwarded, ExternalLink } from "lucide-react";
import { Panel, PanelHeader } from "./panel";

/** How many rows before the list stops being a list and becomes a wall. */
const SHOWN = 15;

/** "August" from a YYYY-MM-DD. Parsed as UTC so it cannot slip a month. */
function monthName(today: string): string {
  return new Date(`${today}T12:00:00Z`).toLocaleDateString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
}

/**
 * The deals still open, oldest first.
 *
 * Every other panel here reports on calls that are finished. This one is the
 * only thing on the page that is a job rather than a number: a BAMFAM is a
 * prospect who said speak to me again, and the row recording that never
 * changes, so on day fifty it still reads exactly as it did on day two.
 */
export function FollowUps({
  calls,
  today,
  order = 0,
}: {
  /** Every call, unfiltered — see the note in the footer. */
  calls: CallRecord[];
  today: string;
  order?: number;
}) {
  const result = followUps(calls, today);
  const shown = result.items.slice(0, SHOWN);
  const rest = result.items.slice(SHOWN);
  const restWorth = rest.reduce((sum, i) => sum + i.worth, 0);

  return (
    <Panel order={order}>
      <PanelHeader
        icon={PhoneForwarded}
        title={`Follow-ups owed — ${monthName(today)}`}
        subtitle={
          result.items.length === 0
            ? undefined
            : `${result.items.length} ${
                result.items.length === 1 ? "call" : "calls"
              } ended on "speak again" and nothing has been marked since${
                result.cold > 0
                  ? `, ${result.cold} of them waiting over a fortnight`
                  : ""
              }.`
        }
        right={
          result.items.length > 0 ? (
            <span className="font-mono text-[13px] tabular-nums text-gold-300">
              {formatReporting(result.worth)}{" "}
              {/* A REAL SPACE, NOT JUST A MARGIN. `ml-1.5` separates the two
                  words on screen and leaves none in the text itself, so a
                  screen reader and anyone copying the line both get
                  "$27,000quoted". This page has already shipped that exact
                  defect twice. */}
              <span className="text-[11px] font-sans text-zinc-400">quoted</span>
            </span>
          ) : null
        }
        info={
          <>
            <p>
              This is {monthName(today)}&apos;s list, and it does not carry into
              next month — the list starts clean each time the month turns over.
            </p>
            <p>
              A prospect also leaves it the moment a later call with them
              reaches the tracker, because nothing ever edits the original row:
              the follow-up arrives as its own recording a few days later.
              {result.spokenAgain > 0 && (
                <>
                  {" "}
                  {result.spokenAgain}{" "}
                  {result.spokenAgain === 1
                    ? "prospect has"
                    : "prospects have"}{" "}
                  dropped off that way. A follow-up that happens without being
                  recorded cannot be told apart from one that never happened, so
                  it stays until the month turns over.
                </>
              )}
            </p>
            {/* EVERY GAP AFTER AN EXPRESSION IS AN EXPLICIT {" "}.
                This paragraph and the one above it are where two missing
                spaces were showing on the live page — "from Augustended on"
                and "$166,500quoted". Both were written as `{value} word` on a
                single source line, which normally keeps its space; both text
                runs also contained an HTML entity, and the leading space was
                being dropped on the way through. Not worth relying on: a
                literal space cannot be swallowed. */}
            {result.lapsed > 0 && (
              <p>
                {result.lapsed}{" "}
                {result.lapsed === 1 ? "older one is" : "older ones are"}{" "}
                not shown —{" "}
                {formatReporting(result.lapsedWorth)}{" "}
                quoted, still open on the tracker, but last month&apos;s list
                rather than this one.
              </p>
            )}
            <p>The date range at the top of the page does not apply here.</p>
          </>
        }
      />

      {result.items.length === 0 ? (
        <p className="max-w-[80ch] t-body text-zinc-300">
          Nothing owed from {monthName(today)}&apos;s calls.
          {result.lapsed > 0 && (
            <>
              {" "}
              <span className="text-zinc-400">
                {result.lapsed} {result.lapsed === 1 ? "is" : "are"} still open
                from last month
              </span>
              , worth {formatReporting(result.lapsedWorth)}. Those do not carry
              over — the list starts clean each month.
            </>
          )}
        </p>
      ) : (
        <>
          {/* Named columns. The right-hand figure was reading as revenue when
              it is a quote — the price talked about on a call that did not
              close. Nothing here is money in.

              Hidden below `sm`, where the rows stack and each value carries its
              own label instead. Four fixed columns totalling 272px plus gaps
              left the prospect's name — the one thing the list is for — with
              nothing to sit in at phone width, so the names vanished. */}
          <div className="hidden gap-x-3 px-1 pb-1.5 sm:grid sm:grid-cols-[72px_minmax(0,1fr)_110px_110px_12px]">
            <span className="t-label text-zinc-400">Waiting</span>
            <span className="t-label text-zinc-400">Prospect</span>
            <span className="t-label text-zinc-400">Closer</span>
            <span className="t-label text-right text-zinc-400">Price quoted</span>
            <span />
          </div>

          {/* STACKED ON A PHONE, COLUMNS ON A LAPTOP.
              A grid rather than a flex row, so the prospect's name can lead on
              a narrow screen and still sit in the second column on a wide one
              without being reordered in the markup. Four fixed flex columns
              totalling 272px plus gaps used to leave the name — the one thing
              a worklist is for — nothing to sit in at phone width, and it
              vanished entirely. */}
          {/* Rules between rows rather than a box around each — the same list
              shape, and the same reasoning, as Payments to collect below. */}
          <div className="divide-y divide-white/[0.05] border-y border-white/[0.05]">
            {shown.map(({ call, age, worth }) => (
              <a
                key={call.id}
                href={call.notion_url}
                target="_blank"
                rel="noopener noreferrer"
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-1 py-2.5 transition-colors hover:bg-white/[0.02] sm:grid-cols-[72px_minmax(0,1fr)_110px_110px_12px]"
              >
                <span className="col-span-3 min-w-0 truncate text-[15px] font-medium text-zinc-100 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:text-[13px] sm:font-normal sm:text-zinc-200">
                  {call.name || "Unknown"}
                </span>
                <span
                  className={`font-mono text-[13px] tabular-nums sm:col-start-1 sm:row-start-1 ${
                    age >= FOLLOW_UP_COLD_DAYS
                      ? "text-[var(--color-negative)]"
                      : age >= FOLLOW_UP_STALE_DAYS
                      ? "text-amber-400"
                      : "text-zinc-300"
                  }`}
                >
                  {age}d ago
                </span>
                <span className="min-w-0 truncate text-[13px] text-zinc-400 sm:col-start-3 sm:row-start-1">
                  {call.closer ?? "—"}
                </span>
                <span className="text-right font-mono text-[13px] tabular-nums text-zinc-300 sm:col-start-4 sm:row-start-1">
                  {worth > 0 ? formatMoney(call.price_discussed, call.currency) : "—"}
                </span>
                <ExternalLink className="hidden h-3 w-3 text-zinc-500 sm:col-start-5 sm:row-start-1 sm:block" />
              </a>
            ))}
          </div>

          {/* Never a silent cut. A worklist that quietly stops at fifteen reads
              as a worklist of fifteen. */}
          {rest.length > 0 && (
            <p className="mt-2 text-[11px] text-zinc-400">
              {rest.length} more, worth {formatReporting(restWorth)}, all newer
              than these — open the tracker to work the rest.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
