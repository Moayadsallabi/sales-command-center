"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CallRecord,
  OUTCOME_COLORS,
  overallScore,
  leadQualityScore,
  hasLeadAssessment,
} from "@/lib/types";
import { DIMENSIONS, GOOD_SCORE, verdictFor } from "@/lib/dimensions";
import { LEAD_FACTORS, LEAD_MAX, leadBandFor } from "@/lib/lead-quality";
import { POOR_SCORE } from "@/lib/stats";
import { LinkedBooking } from "@/lib/bookings";
import { withTimestamps } from "@/lib/timestamps";
import {
  X,
  ExternalLink,
  Video,
  ChevronDown,
  Target,
  Zap,
  UserSearch,
  CalendarClock,
} from "lucide-react";

function scoreHex(score: number): string {
  if (score >= 7.5) return "#d4af37";
  if (score >= 6) return "#f59e0b";
  return "#ef4444";
}

/** Same three bands as the call score, on the lead's 0–100 scale. */
function leadHex(score: number): string {
  if (score >= 75) return "#d4af37";
  if (score >= 55) return "#f59e0b";
  return "#ef4444";
}

/**
 * The booking behind the call: how it arrived, how long it sat there, and what
 * the prospect typed into the form before anyone spoke to them.
 *
 * Worth its place above the scorecard because it is the half a closer can
 * prepare from. The form answers in particular are the prospect's own words on
 * their situation, given without a salesperson in the room.
 */
function BeforeTheCall({ booking }: { booking: LinkedBooking }) {
  const leadTime =
    booking.lead_time_days == null
      ? null
      : booking.lead_time_days < 1
      ? "same day"
      : `${Math.round(booking.lead_time_days)} day${
          Math.round(booking.lead_time_days) === 1 ? "" : "s"
        } ahead`;

  const facts = [
    booking.event_type,
    leadTime && `booked ${leadTime}`,
    booking.tracking.source && `from ${booking.tracking.source}`,
    booking.tracking.campaign,
    booking.host && `assigned to ${booking.host}`,
    booking.rescheduled ? "rescheduled from an earlier slot" : null,
  ].filter((f): f is string => Boolean(f));

  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
      <div className="mb-2 flex items-center gap-2">
        <CalendarClock className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.5} />
        <h4 className="text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-600">
          Before the call
        </h4>
      </div>

      {facts.length > 0 && (
        <p className="text-[12px] leading-relaxed text-zinc-400">
          {facts.join(" · ")}
        </p>
      )}

      {booking.answers.length > 0 && (
        <dl className="mt-3 space-y-2">
          {booking.answers.map((qa) => (
            <div key={qa.question}>
              <dt className="text-[11px] text-zinc-600">{qa.question}</dt>
              <dd className="text-[13px] leading-relaxed text-zinc-300">
                {qa.answer}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-2 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-600">
        {title}
      </h4>
      {children}
    </div>
  );
}

export function ScorecardPanel({
  call,
  booking = null,
  onClose,
}: {
  call: CallRecord | null;
  /** The Calendly booking this call came from, when Calendly is connected. */
  booking?: LinkedBooking | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!call) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [call, onClose]);

  return (
    <AnimatePresence>
      {call && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />
          {/* Keyed on the call so the collapse below resets between calls. */}
          <ScorecardBody
            key={call.id}
            call={call}
            booking={booking}
            onClose={onClose}
          />
        </>
      )}
    </AnimatePresence>
  );
}

function ScorecardBody({
  call,
  booking,
  onClose,
}: {
  call: CallRecord;
  booking: LinkedBooking | null;
  onClose: () => void;
}) {
  const [showAllScores, setShowAllScores] = useState(false);
  const [showAllFactors, setShowAllFactors] = useState(false);

  const overall = overallScore(call);
  const lead = leadQualityScore(call);
  const leadAssessed = hasLeadAssessment(call);

  // The lead factors furthest below their own ceilings. Each has a different
  // maximum, so they only rank against each other as a share of it.
  const thinnest = LEAD_FACTORS.filter((f) => call.lead[f.key] != null)
    .map((factor) => ({
      factor,
      score: call.lead[factor.key] as number,
      share: (call.lead[factor.key] as number) / factor.max,
    }))
    .sort((a, b) => a.share - b.share)
    .slice(0, 3);

  // The parts of this call that actually went wrong. A wall of 7s is not the
  // story; the two or three below the line are.
  const weakSpots = DIMENSIONS.map((dimension) => ({
    dimension,
    score: call.scores[dimension.key],
  }))
    .filter(
      (e): e is { dimension: (typeof DIMENSIONS)[number]; score: number } =>
        e.score != null && e.score < GOOD_SCORE,
    )
    .sort((a, b) => a.score - b.score);

  // On a bad call almost everything is below the line. Listing all of it is the
  // wall of numbers this panel exists to avoid — the rest stay in the collapse.
  const WORST_SHOWN = 3;
  const shown = weakSpots.slice(0, WORST_SHOWN);
  const alsoWeak = weakSpots.length - shown.length;

  const flags = [
    { label: "Gave away value before a commitment", on: call.flags.value_leak },
    {
      label: "Booked a follow-up instead of pushing",
      on: call.flags.follow_up_trap,
    },
    {
      label: "Said the price before they were sold",
      on: call.flags.early_price_drop,
    },
  ].filter((f) => f.on);

  return (
    <motion.aside
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      role="dialog"
      aria-label={`Scorecard for the call with ${call.name}`}
      className="fixed right-0 top-0 z-50 h-full w-full max-w-[540px] overflow-y-auto border-l border-white/[0.08] bg-[#0c0c0e] shadow-2xl"
    >
      <div className="sticky top-0 z-10 border-b border-white/[0.06] bg-[#0c0c0e]/95 px-6 py-5 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-zinc-100">
              {call.name || "Unknown"}
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">
              {call.closer ?? "Unassigned"}
              {call.call_date ? ` · ${call.call_date}` : ""}
              {call.duration != null ? ` · ${call.duration} min` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close scorecard"
            className="shrink-0 rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Verdict and flags together, so "they bought but leaked value"
                  is visible without scrolling. */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span
            className="rounded-full px-2.5 py-1 text-[10px] font-medium"
            style={{
              background: `${OUTCOME_COLORS[call.outcome ?? ""] ?? "#6b7280"}1a`,
              color: OUTCOME_COLORS[call.outcome ?? ""] ?? "#a1a1aa",
            }}
          >
            {call.outcome ?? "Unknown"}
          </span>
          {overall != null && (
            <span className="font-mono text-sm tabular-nums" title="How the call was run">
              <span
                className="text-lg font-bold"
                style={{ color: scoreHex(overall) }}
              >
                {overall.toFixed(1)}
              </span>
              <span className="text-zinc-600">/10</span>{" "}
              <span className="text-zinc-500">{verdictFor(overall)}</span>
            </span>
          )}
          {/* Sat next to the call score deliberately. The pair is the finding:
              the same 5/10 means opposite things at 82 and at 31. */}
          {lead != null && (
            <span
              className="font-mono text-sm tabular-nums"
              title="How good the lead was, scored separately from the call"
            >
              <span className="text-lg font-bold" style={{ color: leadHex(lead) }}>
                {lead}
              </span>
              <span className="text-zinc-600">/{LEAD_MAX}</span>{" "}
              <span className="text-zinc-500">{leadBandFor(lead)} lead</span>
            </span>
          )}
          {flags.map((f) => (
            <span
              key={f.label}
              className="rounded-full border border-red-500/25 bg-red-500/[0.08] px-2.5 py-1 text-[10px] text-red-300"
            >
              {f.label}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-6 px-6 py-6">
        {/* Everything below this comes out of the recording, so it only exists
            once the call happened. This is what was knowable beforehand — and
            for a no-show it is the only thing on the page. */}
        {booking && <BeforeTheCall booking={booking} />}

        {overall == null ? (
          <p className="text-sm text-zinc-500">
            {call.outcome === "No show"
              ? "Nobody turned up, so there is nothing to score."
              : "This call has no scorecard. It was recorded before the scoring was installed, or the scoring step failed."}
          </p>
        ) : (
          <>
            {/* The drill leads, because it is the only part anyone acts on. */}
            {call.next_call_drill && (
              <div className="rounded-lg border border-gold-500/25 bg-gold-500/[0.07] p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Zap className="h-3.5 w-3.5 text-gold-400" strokeWidth={2} />
                  <h4 className="text-[10px] font-medium uppercase tracking-[0.1em] text-gold-400">
                    Do this on the next call
                  </h4>
                </div>
                <p className="text-[14px] leading-relaxed text-zinc-100">
                  {withTimestamps(call.next_call_drill, call.recording_url)}
                </p>
              </div>
            )}

            {call.the_moment && (
              <Section title="Where it turned">
                <p className="text-[13px] leading-relaxed text-zinc-300">
                  {withTimestamps(call.the_moment, call.recording_url)}
                </p>
              </Section>
            )}

            {weakSpots.length > 0 && (
              <Section title="What went wrong">
                <div className="space-y-2">
                  {shown.map(({ dimension, score }) => (
                    <div
                      key={dimension.key}
                      className="flex items-start gap-3 rounded-lg border border-white/[0.05] bg-white/[0.015] px-3.5 py-2.5"
                    >
                      <span
                        className="mt-px w-6 shrink-0 font-mono text-[15px] font-bold tabular-nums"
                        style={{ color: scoreHex(score) }}
                      >
                        {score}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-zinc-200">
                          {dimension.plainName}
                        </p>
                        <p className="mt-0.5 text-[12px] text-zinc-500">
                          {dimension.plainQuestion}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                {alsoWeak > 0 && (
                  <p className="mt-2 text-[11px] text-zinc-600">
                    {alsoWeak} other {alsoWeak === 1 ? "part" : "parts"} also scored
                    below {GOOD_SCORE}. Open all eight below to see them.
                  </p>
                )}
                {alsoWeak === 0 && weakSpots.every((w) => w.score >= POOR_SCORE) && (
                  <p className="mt-2 text-[11px] text-zinc-600">
                    Nothing here is badly wrong — these are just the weakest parts
                    of a call that mostly went well.
                  </p>
                )}
              </Section>
            )}

            {weakSpots.length === 0 && (
              <Section title="What went wrong">
                <p className="flex items-center gap-2 text-[13px] text-zinc-400">
                  <Target
                    className="h-3.5 w-3.5 text-gold-500"
                    strokeWidth={1.5}
                  />
                  Nothing scored below {GOOD_SCORE}. Worth keeping as an
                  example.
                </p>
              </Section>
            )}

            {call.flags.weakest_belief &&
              call.flags.weakest_belief !== "None" && (
                <Section title="What they never believed">
                  <p className="text-[13px] text-zinc-300">
                    {call.flags.weakest_belief}
                  </p>
                </Section>
              )}

            {leadAssessed && (
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-4">
                <div className="mb-3 flex items-center gap-2">
                  <UserSearch className="h-3.5 w-3.5 text-zinc-500" strokeWidth={1.5} />
                  <h4 className="text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500">
                    The lead they were handed
                  </h4>
                </div>

                {lead == null ? (
                  <p className="text-[12px] text-zinc-500">
                    The call ended before enough of the prospect was established to
                    score them. That is a fact about the call, not about the lead.
                  </p>
                ) : (
                  <>
                    {call.lead_read && (
                      <p className="mb-3 text-[13px] leading-relaxed text-zinc-300">
                        {withTimestamps(call.lead_read, call.recording_url)}
                      </p>
                    )}

                    <p className="mb-2 text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                      Thinnest on
                    </p>
                    <div className="space-y-1.5">
                      {thinnest.map(({ factor, score }) => (
                        <div key={factor.key} className="flex items-center gap-3">
                          <span
                            className="w-[132px] shrink-0 truncate text-[12px] text-zinc-400"
                            title={factor.question}
                          >
                            {factor.name}
                          </span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${(score / factor.max) * 100}%`,
                                background: leadHex((score / factor.max) * 100),
                              }}
                            />
                          </div>
                          <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-zinc-400">
                            {score}
                            <span className="text-zinc-600">/{factor.max}</span>
                          </span>
                        </div>
                      ))}
                    </div>

                    {call.objections.length > 0 && (
                      <div className="mt-4">
                        <p className="mb-2 text-[10px] uppercase tracking-[0.1em] text-zinc-600">
                          Objections raised
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {call.objections.map((objection) => {
                            const decided = objection === call.primary_objection;
                            return (
                              <span
                                key={objection}
                                title={
                                  decided
                                    ? "The one that decided the call"
                                    : "Raised, but not what decided it"
                                }
                                className={
                                  decided
                                    ? "rounded-full border border-red-500/30 bg-red-500/[0.1] px-2.5 py-1 text-[11px] text-red-300"
                                    : "rounded-full border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-[11px] text-zinc-400"
                                }
                              >
                                {objection}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="mt-4">
                      <button
                        onClick={() => setShowAllFactors((v) => !v)}
                        aria-expanded={showAllFactors}
                        className="flex w-full items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-600 transition-colors hover:text-zinc-400"
                      >
                        <ChevronDown
                          className={`h-3 w-3 transition-transform ${
                            showAllFactors ? "rotate-180" : ""
                          }`}
                        />
                        All {LEAD_FACTORS.length} lead factors
                      </button>
                      <AnimatePresence initial={false}>
                        {showAllFactors && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            className="overflow-hidden"
                          >
                            <div className="space-y-2 pt-3">
                              {LEAD_FACTORS.map((factor) => {
                                const score = call.lead[factor.key];
                                return (
                                  <div key={factor.key} className="flex items-center gap-3">
                                    <span
                                      className="w-[132px] shrink-0 truncate text-[12px] text-zinc-400"
                                      title={factor.question}
                                    >
                                      {factor.name}
                                      {factor.belief && (
                                        <span className="text-zinc-600">
                                          {" "}
                                          · {factor.belief}
                                        </span>
                                      )}
                                    </span>
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                                      {score != null && (
                                        <div
                                          className="h-full rounded-full"
                                          style={{
                                            width: `${(score / factor.max) * 100}%`,
                                            background: leadHex((score / factor.max) * 100),
                                          }}
                                        />
                                      )}
                                    </div>
                                    <span className="w-10 shrink-0 text-right font-mono text-[12px] tabular-nums text-zinc-400">
                                      {score ?? "—"}
                                      <span className="text-zinc-600">/{factor.max}</span>
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                            <p className="pt-2 text-[11px] text-zinc-600">
                              A factor showing — never came up on the call, so it is
                              left out of the {LEAD_MAX} rather than counted as zero.
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </>
                )}
              </div>
            )}

            <div>
              <button
                onClick={() => setShowAllScores((v) => !v)}
                aria-expanded={showAllScores}
                className="flex w-full items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-600 transition-colors hover:text-zinc-400"
              >
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${
                    showAllScores ? "rotate-180" : ""
                  }`}
                />
                All eight scores
              </button>
              <AnimatePresence initial={false}>
                {showAllScores && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2 pt-3">
                      {DIMENSIONS.map((dimension) => {
                        const score = call.scores[dimension.key];
                        return (
                          <div
                            key={dimension.key}
                            className="flex items-center gap-3"
                          >
                            <span
                              className="w-[150px] shrink-0 truncate text-[12px] text-zinc-400"
                              title={dimension.plainQuestion}
                            >
                              {dimension.plainName}
                            </span>
                            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.04]">
                              {score != null && (
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${(score / 10) * 100}%`,
                                    background: scoreHex(score),
                                  }}
                                />
                              )}
                            </div>
                            <span
                              className="w-6 shrink-0 text-right font-mono text-[12px] tabular-nums"
                              style={{
                                color:
                                  score == null ? "#52525b" : scoreHex(score),
                              }}
                            >
                              {score ?? "—"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}

        {call.summary && (
          <Section title="What happened">
            <p className="text-[13px] leading-relaxed text-zinc-400">
              {withTimestamps(call.summary, call.recording_url)}
            </p>
          </Section>
        )}

        <div className="flex flex-wrap gap-3 border-t border-white/[0.06] pt-5">
          {call.recording_url && (
            <a
              href={call.recording_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] text-zinc-400 transition-colors hover:text-gold-400"
            >
              <Video className="h-3.5 w-3.5" strokeWidth={1.5} />
              Watch the recording
            </a>
          )}
          <a
            href={call.notion_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12px] text-zinc-400 transition-colors hover:text-gold-400"
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.5} />
            Full written breakdown
          </a>
        </div>
      </div>
    </motion.aside>
  );
}
