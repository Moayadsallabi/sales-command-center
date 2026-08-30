"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* --------------------------------------------------------------- motion */

/**
 * THE WHOLE PAGE ARRIVES IN A QUARTER OF A SECOND.
 *
 * Every panel used to carry its own hand-written delay, and they climbed: the
 * KPI cards started at 0, the leaderboard waited 0.55s, the call table 1.0s.
 * Add the 0.4s each animation took to run and the page finished assembling
 * about a second and a half after it was ready. On a screen someone opens
 * twenty times a day that is real time spent watching furniture slide in, and
 * it made the dashboard feel slower than the Notion query behind it.
 *
 * One step, one cap, one duration, declared here. `order` comes from the page
 * so reading order and animation order are the same list — a panel moved up
 * the page cannot keep a stale delay from where it used to sit.
 */
const STEP = 0.03;
const MAX_DELAY = 0.24;
const DURATION = 0.28;

/**
 * Motion props for a panel at position `order`, or nothing at all when the
 * reader has asked their system for reduced motion. `initial: false` tells
 * framer-motion to mount at the final values rather than animate to them, so
 * the content is simply there.
 *
 * The CSS half of this promise — transitions, keyframes, the fade-up class —
 * lives in the `prefers-reduced-motion` block in globals.css. JavaScript
 * animation does not read that media query, so both are needed.
 */
export function usePanelMotion(order = 0) {
  const still = useReducedMotion();

  if (still) return { initial: false as const };

  return {
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: {
      delay: Math.min(order * STEP, MAX_DELAY),
      duration: DURATION,
      // Decelerating: fast out of the gate, settles rather than eases to a
      // stop. Reads as the panel arriving, not as it being animated.
      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
    },
  };
}

/* ---------------------------------------------------------------- panel */

/**
 * The card every section of the page sits in.
 *
 * `tone="alert"` is the amber treatment, and is deliberately the only way to
 * get amber on this page: the two panels that use it describe how trustworthy
 * the page is, and amber is reserved for exactly that. Anything else wanting
 * to look urgent should be using the positive/negative pair instead.
 */
export function Panel({
  order = 0,
  tone = "default",
  padded = true,
  className,
  children,
}: {
  order?: number;
  tone?: "default" | "alert";
  /** False for panels whose own header and table manage their edges. */
  padded?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const motionProps = usePanelMotion(order);

  return (
    <motion.section
      {...motionProps}
      className={cn(
        "rounded-xl border",
        padded && "p-5",
        tone === "alert"
          ? "border-amber-500/25 bg-amber-500/[0.04]"
          : "border-white/[0.06] glass-card",
        className
      )}
    >
      {children}
    </motion.section>
  );
}

/* --------------------------------------------------------------- header */

/**
 * Title, one line of subtitle, and everything else behind an info button.
 *
 * The long explanations on this page are the best writing in it and they were
 * costing the most: four to six lines of instructions above several panels, so
 * the page opened as a manual and the charts had to be scrolled to. The rule
 * now is one line on screen — what this panel answers — and the full
 * explanation one click away, where someone goes when the panel surprises
 * them.
 *
 * A `<details>` element would be fewer moving parts, but it pushes the panel
 * open and shoves everything below it down the page. This floats.
 */
export function PanelHeader({
  icon: Icon,
  title,
  subtitle,
  info,
  right,
  className,
}: {
  icon?: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  /** One line. If it needs two, it belongs in `info`. */
  subtitle?: string;
  /** The long form. Omit when there is nothing more to say. */
  info?: React.ReactNode;
  /** Counts, scope notes, a reset button — anything right-aligned. */
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && (
            <Icon className="h-3.5 w-3.5 shrink-0 text-gold-500" strokeWidth={1.5} />
          )}
          <h3 className="t-label truncate text-zinc-300">{title}</h3>
          {info && <InfoButton title={title}>{info}</InfoButton>}
        </div>
        {right && <div className="shrink-0 text-right">{right}</div>}
      </div>
      {subtitle && (
        <p className="mt-1.5 max-w-[80ch] t-body text-zinc-400">{subtitle}</p>
      )}
    </div>
  );
}

function InfoButton({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const still = useReducedMotion();

  /**
   * A tenth of a second of fade and a 4px rise, and no more than that.
   *
   * The panel it explains is already on screen; this is a note arriving beside
   * it, not a page transition. Long enough to see where it came from, short
   * enough that a second click to dismiss it never has to wait. Opacity and
   * transform only, so nothing around it is re-laid out.
   */
  const pop = still
    ? {}
    : {
        initial: { opacity: 0, y: -4, scale: 0.98 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -4, scale: 0.98 },
        transition: { duration: 0.12, ease: "easeOut" as const },
      };

  return (
    <span className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        aria-label={`How to read ${title}`}
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
          open
            ? "border-gold-500/40 bg-gold-500/15 text-gold-400"
            : "border-white/[0.10] text-zinc-500 hover:border-white/20 hover:text-zinc-300"
        )}
      >
        <Info className="h-2.5 w-2.5" strokeWidth={2.5} />
      </button>

      {/* Clicking anywhere else closes it. Sits under the popover but over
          everything else, so the first click outside is a dismissal rather
          than an accidental filter change.

          Outside the AnimatePresence below, and deliberately: the dismissal
          surface has to disappear on the click, not a tenth of a second after
          it, or the same click that closes the note is also swallowed by a
          backdrop that is still on its way out. */}
      {open && (
        <button
          type="button"
          aria-hidden
          tabIndex={-1}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 cursor-default"
        />
      )}

      {/* One keyed child, not a fragment. AnimatePresence tracks its direct
          children by key to know what is leaving; a fragment is one opaque
          child to it and the exit animation never runs. */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="info"
            {...pop}
            // The transform origin is the button it grew out of, so the rise
            // reads as the note unfolding from the icon rather than drifting
            // in from somewhere off to the left.
            style={{ transformOrigin: "top left" }}
            id={id}
            role="dialog"
            aria-label={`How to read ${title}`}
            onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
            className="absolute left-0 top-6 z-50 w-[min(30rem,calc(100vw-3rem))] rounded-lg border border-white/[0.10] bg-[#141418] p-4 shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between gap-4">
              <span className="t-label text-zinc-500">How to read this</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-zinc-500 transition-colors hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="space-y-2 t-body text-zinc-300">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
