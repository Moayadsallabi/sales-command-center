"use client";

import { Reconciliation } from "@/lib/reconcile";
import { collectedToDate, formatMoney, formatReporting } from "@/lib/money";
import { Scale, ExternalLink } from "lucide-react";
import { Panel, PanelHeader } from "./panel";

/** How many rows before the list stops being a list and becomes a wall. */
const SHOWN = 8;

/**
 * Rows the payment processor disagrees with.
 *
 * Two different mistakes, kept apart because they cost different things. A
 * prospect who paid but is not marked Customer is missing from close rate and
 * revenue both — the dashboard is understating the business. A customer whose
 * cash figure disagrees with the processor is only wrong about the money.
 *
 * WHAT CHANGED, 2026-08-18. The ruling this panel used to wait for has been
 * made: "even if it was a small deposit it still technically counts as a close"
 * (and, the day before, "Whop is the only source of truth for money"). So the
 * rows below are now COUNTED as wins — see lib/settle.ts — and this panel no
 * longer reports money missing from the totals. What it reports is that the
 * tracker rows are stale: the dashboard has moved on and Notion has not, and
 * only a person can correct a Notion row.
 *
 * The panel is deliberately still here rather than deleted. Settling fixes the
 * number on screen; it does not fix the record, and a closer reading their own
 * tracker would still see a loss where the dashboard shows a win.
 */
export function WhopGap({
  reconciliation,
  windowLabel,
  order = 0,
}: {
  /**
   * Already narrowed to the period on screen by the caller — see the note on
   * `scopedReconciliation` in dashboard.tsx for which date each half is
   * placed by, and why the outcome and source pills are not applied.
   */
  reconciliation: Reconciliation;
  /**
   * The dates that narrowing produced, said on the page rather than implied —
   * or null when the range is open at both ends and nothing was narrowed.
   *
   * NULL RATHER THAN THE WORDS "Every call on record". This started as a string
   * compared against that exact phrase, which is a join on display copy: reword
   * the label in dashboard.tsx and this panel silently reads "Only rows dated
   * inside Every call on record", with nothing failing.
   */
  windowLabel: string | null;
  order?: number;
}) {
  const { missedCloses, cashOff, untracked, untrackedWorth } = reconciliation;
  const clean = missedCloses.length === 0 && cashOff.length === 0;

  return (
    <Panel order={order} tone={clean ? "default" : "alert"}>
      <PanelHeader
        icon={Scale}
        title="Where Whop disagrees with the tracker"
        subtitle={
          clean
            ? undefined
            : "Rows the figures above have already corrected, and the tracker has not."
        }
        info={
          <>
            <p>
              Two different mistakes, kept apart because they cost different
              things. A prospect who paid but is not marked Customer was missing
              from close rate and revenue both. A customer whose cash figure
              disagrees with the processor is only wrong about the money.
            </p>
            <p>
              A row is written when the call ends, and money does not respect
              that boundary: a prospect marked as a follow-up on Tuesday pays on
              Friday, and nothing goes back to change Tuesday. The money wins —
              every row here is already counted as a close in the figures above.
              What is left is the record itself, which still says otherwise.
            </p>
            <p>
              A row with no prospect email has to be matched on name, and those
              are marked as guesses. Running{" "}
              <code className="text-zinc-400">
                npm run check:payments -- --apply
              </code>{" "}
              writes these corrections into the tracker; nothing here edits
              Notion on its own.
            </p>
          </>
        }
      />

      {clean ? (
        <p className="t-body text-zinc-300">
          Every prospect who paid in this period is marked Customer, and every
          customer&apos;s cash figure matches what the processor banked. Nothing
          in these dates is being counted differently from how it was recorded.
        </p>
      ) : (
        <>
          {missedCloses.length > 0 && (
            <Section
              title={`${missedCloses.length} took money but ${
                missedCloses.length === 1 ? "is" : "are"
              } not marked Customer`}
              note={`${formatReporting(
                missedCloses.reduce((s, m) => s + m.paid, 0)
              )} received. Counted as closes above; still recorded as losses in the tracker`}
            >
              {missedCloses.slice(0, SHOWN).map((m) => (
                <Row
                  key={m.call.id}
                  href={m.call.notion_url}
                  date={m.call.call_date}
                  name={m.call.name}
                  certain={m.certain}
                  left={m.call.outcome ?? "—"}
                  right={`paid ${formatReporting(m.paid)}${
                    m.payments > 1 ? ` over ${m.payments}` : ""
                  }`}
                />
              ))}
              {missedCloses.length > SHOWN && (
                <Rest count={missedCloses.length - SHOWN} />
              )}
            </Section>
          )}

          {cashOff.length > 0 && (
            <Section
              title={`${cashOff.length} customer ${
                cashOff.length === 1 ? "row disagrees" : "rows disagree"
              } with Whop on cash`}
              note="the deal is counted; the money on it is not what arrived"
            >
              {cashOff.slice(0, SHOWN).map((m) => (
                <Row
                  key={m.call.id}
                  href={m.call.notion_url}
                  date={m.call.call_date}
                  name={m.call.name}
                  certain={m.certain}
                  left={`tracker ${formatMoney(
                    collectedToDate(m.call),
                    m.call.currency
                  )}`}
                  right={`Whop ${formatReporting(m.paid)}`}
                />
              ))}
              {cashOff.length > SHOWN && <Rest count={cashOff.length - SHOWN} />}
            </Section>
          )}
        </>
      )}

      {/* The standing explanation moved into the info popover. This stays on
          screen because it is a live count, not a rule. */}
      {/* WHAT THIS SENTENCE COUNTS, SAID IN THE SENTENCE. These buyers are
          placed by their FIRST payment, because an untracked buyer has no call
          to be placed by. The money is their lifetime total, which is a wider
          population than the date range — so the sentence says "first paid
          here" and states the total separately, rather than reading as though
          all of it landed inside these dates. */}
      {untracked > 0 && (
        <p className="mt-4 max-w-[80ch] t-body text-zinc-300">
          <span className="font-medium text-zinc-100">
            {untracked} {untracked === 1 ? "buyer" : "buyers"} first paid in
            this period with no call on this tracker at all.
          </span>{" "}
          That is the coverage gap rather than a typing gap — those calls were
          never recorded, never reached the automation, or never happened. They
          have paid {formatReporting(untrackedWorth)} between them to date.
        </p>
      )}

      {/* Nine panels above this one narrow to the date buttons. Saying that
          this one does too is cheaper than letting a reader wonder why a row
          they remember is missing. */}
      <p className="mt-4 text-[11px] text-zinc-400">
        {windowLabel === null
          ? "Every call on record."
          : `Only rows dated inside ${windowLabel}. Widen the dates to see older ones.`}
      </p>
    </Panel>
  );
}

/* ---------------------------------------------------------------- pieces */

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 last:mb-0">
      <h4 className="text-[13px] font-medium text-zinc-200">{title}</h4>
      <p className="mb-2 text-[11px] text-zinc-400">{note}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  href,
  date,
  name,
  certain,
  left,
  right,
}: {
  href: string;
  date: string | null;
  name: string;
  certain: boolean;
  left: string;
  right: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2 transition-colors hover:border-white/[0.12] hover:bg-white/[0.03]"
    >
      <span className="w-[62px] shrink-0 font-mono text-[11px] tabular-nums text-zinc-400">
        {date?.slice(5) ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">
        {name || "Unknown"}
        {/* A name match is an inference, and one that would send someone to
            edit the wrong prospect's row if it were wrong. Said, every time. */}
        {!certain && (
          <span className="ml-2 text-[11px] text-amber-300">
            matched on name — check first
          </span>
        )}
      </span>
      <span className="w-[120px] shrink-0 truncate text-right text-[13px] text-zinc-400">
        {left}
      </span>
      <span className="w-[130px] shrink-0 truncate text-right font-mono text-[13px] tabular-nums text-gold-400">
        {right}
      </span>
      <ExternalLink className="h-3 w-3 shrink-0 text-zinc-500" />
    </a>
  );
}

function Rest({ count }: { count: number }) {
  return (
    <p className="pt-1 text-[11px] text-zinc-400">
      and {count} more — run <code>npm run check:payments</code> for the full list.
    </p>
  );
}
