"use client";

import { motion } from "framer-motion";
import { Reconciliation } from "@/lib/reconcile";
import { collectedToDate, formatMoney, formatReporting } from "@/lib/money";
import { Scale, ExternalLink } from "lucide-react";

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
export function WhopGap({ reconciliation }: { reconciliation: Reconciliation }) {
  const { missedCloses, cashOff, untracked, untrackedWorth } = reconciliation;
  const clean = missedCloses.length === 0 && cashOff.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.25, duration: 0.4 }}
      className={`rounded-xl border p-5 ${
        clean ? "border-white/[0.06] glass-card" : "border-amber-500/25 bg-amber-500/[0.04]"
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        <Scale className="h-3.5 w-3.5 text-gold-500" strokeWidth={1.5} />
        <h3 className="text-[11px] font-medium uppercase tracking-[0.1em] text-zinc-500">
          Where Whop disagrees with the tracker
        </h3>
      </div>

      {clean ? (
        <p className="mt-3 text-[13px] text-zinc-400">
          Every prospect who paid is marked Customer, and every customer&apos;s cash
          figure matches what the processor banked. Nothing is being counted
          differently from how it was recorded.
        </p>
      ) : (
        <>
          <p className="mb-5 max-w-[75ch] text-[12px] leading-relaxed text-zinc-600">
            A row is written when the call ends and money does not respect that
            boundary — a prospect marked as a follow-up on Tuesday pays on
            Friday, and nothing goes back to change Tuesday. The money wins:
            every row below is already counted as a close in the figures above.
            What is left is the record itself, which still says otherwise. Each
            links to its page in the tracker so it can be corrected there.
          </p>

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

      <p className="mt-4 max-w-[75ch] text-[11px] leading-relaxed text-zinc-600">
        {untracked > 0 && (
          <>
            <span className="text-zinc-500">
              {untracked} buyers paid {formatReporting(untrackedWorth)} with no
              call on this tracker at all.
            </span>{" "}
            That is the coverage gap rather than a typing gap — those calls were
            never recorded, never reached the automation, or never happened.{" "}
          </>
        )}
        A row with no prospect email has to be matched on name, and those are
        marked as guesses. Running{" "}
        <code className="text-zinc-500">npm run check:payments -- --apply</code>{" "}
        writes these corrections into the tracker.
      </p>
    </motion.div>
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
      <h4 className="text-[12px] font-medium text-zinc-300">{title}</h4>
      <p className="mb-2 text-[11px] text-zinc-600">{note}</p>
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
      <span className="w-[62px] shrink-0 font-mono text-[11px] tabular-nums text-zinc-600">
        {date?.slice(5) ?? "—"}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-200">
        {name || "Unknown"}
        {/* A name match is an inference, and one that would send someone to
            edit the wrong prospect's row if it were wrong. Said, every time. */}
        {!certain && (
          <span className="ml-2 text-[10px] text-amber-400/70">
            matched on name — check first
          </span>
        )}
      </span>
      <span className="w-[120px] shrink-0 truncate text-right text-[12px] text-zinc-500">
        {left}
      </span>
      <span className="w-[130px] shrink-0 truncate text-right font-mono text-[12px] tabular-nums text-gold-400/80">
        {right}
      </span>
      <ExternalLink className="h-3 w-3 shrink-0 text-zinc-700" />
    </a>
  );
}

function Rest({ count }: { count: number }) {
  return (
    <p className="pt-1 text-[11px] text-zinc-500">
      and {count} more — run <code>npm run check:payments</code> for the full list.
    </p>
  );
}
