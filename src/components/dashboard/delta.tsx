"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A number against the same number one period ago.
 *
 * The six headline figures used to be bare values, while the page computed the
 * previous window three lines away and handed it to the leaderboard. A total
 * with no baseline cannot be judged: $40,883 is a good month or a bad one and
 * the tile did not say which.
 *
 * Every metric here is better when it goes up, so up is always the positive
 * colour. If a metric is ever added where that is not true — refunds, cost per
 * booking — it needs an `invert` prop rather than a second component.
 */
export function Delta({
  current,
  previous,
  /**
   * "ratio" reports the change as a percentage of the previous value, which is
   * right for counts and money. "points" subtracts one percentage from the
   * other, which is the only honest way to compare two rates: a close rate
   * going 40% to 44% rose four points, not ten percent.
   */
  unit = "ratio",
  label,
  className,
}: {
  current: number;
  /** Null when the window has no previous period to compare against. */
  previous: number | null;
  unit?: "ratio" | "points";
  /** What the comparison is against, e.g. "vs 1–19 Jul". */
  label: string;
  className?: string;
}) {
  if (previous === null) return null;

  const move =
    unit === "points"
      ? Math.round(current) - Math.round(previous)
      : previous === 0
      ? null
      : Math.round(((current - previous) / previous) * 100);

  // WENT FROM NOTHING TO SOMETHING. Dividing by a previous period of zero
  // gives infinity, and rendering that as "+∞%" or silently as "+100%" are
  // both worse than saying what happened.
  if (move === null) {
    const wording = current > 0 ? "up from zero" : "nothing either period";
    return (
      <span className={cn("text-[11px] text-zinc-400", className)} title={label}>
        {wording}
      </span>
    );
  }

  // Below a whole unit there is nothing to report, and an arrow pointing at a
  // rounding difference is a lie told with a glyph. The period being compared
  // against goes in the tooltip rather than on the tile — spelled out inline
  // it was the widest thing in the card, for the one state that says nothing.
  if (move === 0) {
    return (
      <span
        className={cn("text-[11px] text-zinc-400", className)}
        title={`No change ${label}`}
      >
        no change
      </span>
    );
  }

  const better = move > 0;
  const Icon = better ? ArrowUpRight : ArrowDownRight;
  const amount =
    unit === "points"
      ? `${Math.abs(move)} ${Math.abs(move) === 1 ? "pt" : "pts"}`
      : `${Math.abs(move)}%`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
        better
          ? "bg-[var(--color-positive-dim)] text-[var(--color-positive)]"
          : "bg-[var(--color-negative-dim)] text-[var(--color-negative)]",
        className
      )}
      title={`${better ? "Up" : "Down"} ${amount} ${label}`}
    >
      <Icon className="h-3 w-3" strokeWidth={2.5} />
      {better ? "+" : "−"}
      {amount}
    </span>
  );
}
