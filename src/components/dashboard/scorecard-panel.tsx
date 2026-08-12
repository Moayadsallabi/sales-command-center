"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CallRecord, OUTCOME_COLORS, overallScore } from "@/lib/types";
import { DIMENSIONS, verdictFor } from "@/lib/dimensions";
import { X, ExternalLink, Video } from "lucide-react";

function scoreHex(score: number): string {
  if (score >= 7.5) return "#d4af37";
  if (score >= 6) return "#f59e0b";
  return "#ef4444";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-600 mb-2">
        {title}
      </h4>
      {children}
    </div>
  );
}

export function ScorecardPanel({
  call,
  onClose,
}: {
  call: CallRecord | null;
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

  const overall = call ? overallScore(call) : null;

  const flags = call
    ? [
        { label: "Value leak", on: call.flags.value_leak },
        { label: "Follow-up trap", on: call.flags.follow_up_trap },
        { label: "Price dropped early", on: call.flags.early_price_drop },
      ].filter((f) => f.on)
    : [];

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
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            role="dialog"
            aria-label={`Scorecard for the call with ${call.name}`}
            className="fixed right-0 top-0 z-50 h-full w-full max-w-[540px] overflow-y-auto border-l border-white/[0.08] bg-[#0c0c0e] shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-white/[0.06] bg-[#0c0c0e]/95 px-6 py-5 backdrop-blur-xl">
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

            <div className="space-y-6 px-6 py-6">
              <div className="flex items-center gap-4">
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
                  <span className="font-mono text-sm tabular-nums text-zinc-300">
                    <span
                      className="text-xl font-bold"
                      style={{ color: scoreHex(overall) }}
                    >
                      {overall.toFixed(1)}
                    </span>
                    <span className="text-zinc-600">/10</span>{" "}
                    <span className="text-zinc-500">{verdictFor(overall)}</span>
                  </span>
                )}
              </div>

              {overall == null ? (
                <p className="text-sm text-zinc-500">
                  This call has no scorecard. It was recorded before the scoring rubric was
                  installed, or the scoring step failed.
                </p>
              ) : (
                <Section title="Dimensions">
                  <div className="space-y-2">
                    {DIMENSIONS.map((dimension) => {
                      const score = call.scores[dimension.key];
                      return (
                        <div key={dimension.key} className="flex items-center gap-3">
                          <span
                            className="w-[150px] shrink-0 truncate text-[12px] text-zinc-400"
                            title={dimension.question}
                          >
                            {dimension.name}
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
                            style={{ color: score == null ? "#52525b" : scoreHex(score) }}
                          >
                            {score ?? "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {call.the_moment && (
                <Section title="The moment">
                  <p className="text-[13px] leading-relaxed text-zinc-300">{call.the_moment}</p>
                </Section>
              )}

              {call.next_call_drill && (
                <Section title="Next call drill">
                  <p className="rounded-lg border border-gold-500/20 bg-gold-500/[0.06] p-3.5 text-[13px] leading-relaxed text-zinc-200">
                    {call.next_call_drill}
                  </p>
                </Section>
              )}

              {(flags.length > 0 || call.flags.weakest_belief) && (
                <Section title="Flags">
                  <div className="flex flex-wrap gap-2">
                    {flags.map((f) => (
                      <span
                        key={f.label}
                        className="rounded-full border border-red-500/25 bg-red-500/[0.08] px-2.5 py-1 text-[10px] text-red-300"
                      >
                        {f.label}
                      </span>
                    ))}
                    {call.flags.weakest_belief && call.flags.weakest_belief !== "None" && (
                      <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-[10px] text-zinc-400">
                        Weakest belief: {call.flags.weakest_belief}
                      </span>
                    )}
                  </div>
                </Section>
              )}

              {call.summary && (
                <Section title="Summary">
                  <p className="text-[13px] leading-relaxed text-zinc-400">{call.summary}</p>
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
        </>
      )}
    </AnimatePresence>
  );
}
