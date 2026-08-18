"use client";

import { cn } from "@/lib/utils";

/**
 * WHERE THIS NUMBER CAME FROM, ON EVERY NUMBER.
 *
 * The thing this dashboard already did better than anything else was admit
 * what each figure could not see — and it admitted it in 10px grey text at the
 * bottom of a card, in a different shape on every tile. This makes it the
 * house style instead: one line, one slot, always present, never optional.
 *
 * The dot carries the part you read at a glance. Gold means the number came
 * from the system that OWNS the fact — Whop owns money, Calendly owns
 * bookings. Grey means it came from what people typed into the tracker
 * afterwards, which is a weaker claim about the same thing. A tile that
 * silently changes source when a filter is applied — as the cash tile does,
 * because Whop knows nothing about closers — changes its dot with it.
 */
export type Source = "whop" | "calendly" | "tracker";

const SOURCES: Record<Source, { name: string; owns: boolean; title: string }> = {
  whop: {
    name: "Whop",
    owns: true,
    title: "Read from the payment processor — the system that owns this fact",
  },
  calendly: {
    name: "Calendly",
    owns: true,
    title: "Read from the calendar — the system that owns this fact",
  },
  tracker: {
    name: "Tracker",
    owns: false,
    title:
      "From the Notion call tracker, typed by closers after the call. Nothing outside the tracker confirms it.",
  },
};

export function SourceNote({
  source,
  children,
  className,
}: {
  source: Source;
  /** What this figure cannot see, in plain words. Optional. */
  children?: React.ReactNode;
  className?: string;
}) {
  const meta = SOURCES[source];

  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-[11px] leading-snug text-zinc-400",
        className
      )}
    >
      <span
        aria-hidden
        title={meta.title}
        className={cn(
          "mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full",
          meta.owns ? "bg-gold-500" : "bg-zinc-500"
        )}
      />
      <span className="min-w-0">
        <span className="font-medium text-zinc-300" title={meta.title}>
          {meta.name}
        </span>
        {children ? <span className="text-zinc-400"> — {children}</span> : null}
      </span>
    </p>
  );
}

/**
 * The key for the dots, shown once under the KPI row rather than repeated on
 * every tile. Without it the two greys are just two greys.
 */
export function SourceLegend({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-zinc-400",
        className
      )}
    >
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-gold-500" />
        Read from the system that owns the fact
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-zinc-500" />
        Typed into the tracker by a person
      </span>
    </div>
  );
}
