"use client";

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarRange,
  Check,
  CornerDownLeft,
  PhoneCall,
  Search,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { CallRecord, OUTCOME_COLORS } from "@/lib/types";
import { DATE_RANGES, DateRange, shortDate } from "@/lib/periods";
import { NavSection } from "./section-nav";
import { cn } from "@/lib/utils";
import { matchRank } from "@/lib/match-rank";

/**
 * ONE BOX THAT GETS YOU ANYWHERE ON THE PAGE.
 *
 * ⌘K (Ctrl+K off a Mac) or "/" opens it. Type a prospect's name and Enter
 * opens that call's scorecard, wherever the call sits in time — the call
 * table only lists the period on screen, so a call from last quarter used to
 * mean changing the dates, scrolling, and finding the row. The same box jumps
 * to a section, changes the period and narrows the page to one closer.
 *
 * It adds nothing to the page itself: everything it does is a control that
 * already exists somewhere on screen, reached by typing instead of by
 * scrolling to it.
 */

type Item = {
  id: string;
  group: string;
  label: string;
  /** Muted text after the label: a closer, a date. */
  detail?: string;
  /** Extra words the search matches on but the row does not show. */
  keywords?: string;
  icon: LucideIcon;
  /** A coloured dot in place of the icon — an outcome. */
  dot?: string;
  /** Marks the period or closer currently applied. */
  current?: boolean;
  run: () => void;
};

/** How many calls show under the box before anything is typed. */
const RECENT = 5;
/** And at most how many matches once something is. */
const MATCHES = 8;

export function CommandPalette({
  sections,
  calls,
  closers,
  dateRange,
  selectedCloser,
  onJump,
  onPeriod,
  onCloser,
  onOpenCall,
}: {
  sections: NavSection[];
  calls: CallRecord[];
  closers: string[];
  dateRange: DateRange;
  selectedCloser: string | null;
  onJump: (sectionId: string) => void;
  onPeriod: (range: DateRange) => void;
  onCloser: (closer: string | null) => void;
  onOpenCall: (call: CallRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const still = useReducedMotion();
  const listId = useId();
  // The overlay is portalled to <body>, which only exists in the browser.
  const mounted = useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );

  const show = () => {
    returnTo.current = document.activeElement as HTMLElement | null;
    setQuery("");
    setActive(0);
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    // Back to wherever the reader was, so the keyboard does not land at the
    // top of the page after a jump was cancelled.
    returnTo.current?.focus?.();
  };

  /* ⌘K or Ctrl+K anywhere; "/" when nobody is typing into something else. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) hide();
        else show();
        return;
      }
      if (e.key === "/" && !open && !isTyping(e.target)) {
        e.preventDefault();
        show();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const items = useMemo<Item[]>(() => {
    const close = (fn: () => void) => () => {
      setOpen(false);
      fn();
    };
    const q = query.trim().toLowerCase();

    const byDate = [...calls].sort((a, b) =>
      (b.call_date ?? "").localeCompare(a.call_date ?? "")
    );
    const callItems: Item[] = byDate.map((c) => ({
      id: `call-${c.id}`,
      group: q ? "Calls" : "Recent calls",
      label: c.name || "Unknown",
      detail: [c.closer, c.call_date ? shortDate(c.call_date) : null, c.outcome]
        .filter(Boolean)
        .join(" · "),
      keywords: `${c.closer ?? ""} ${c.outcome ?? ""} ${c.lead_source ?? ""}`,
      icon: PhoneCall,
      dot: c.outcome ? OUTCOME_COLORS[c.outcome] : undefined,
      run: close(() => onOpenCall(c)),
    }));

    const closerItems: Item[] = closers.map((name) => ({
      id: `closer-${name}`,
      group: "Closers",
      label: name,
      detail: selectedCloser === name ? "Showing only them — Enter to show everyone" : "Show only their calls",
      icon: User,
      current: selectedCloser === name,
      run: close(() => {
        onCloser(selectedCloser === name ? null : name);
        onJump("numbers");
      }),
    }));

    const periodItems: Item[] = DATE_RANGES.map((r) => ({
      id: `period-${r.value}`,
      group: "Period",
      label: r.label,
      keywords: "date range window period",
      icon: CalendarRange,
      current: dateRange === r.value,
      run: close(() => onPeriod(r.value)),
    }));

    const sectionItems: Item[] = sections.map((s) => ({
      id: `section-${s.id}`,
      group: "Go to",
      label: s.label,
      icon: s.icon,
      run: close(() => onJump(s.id)),
    }));

    if (!q) {
      return [
        ...callItems.slice(0, RECENT),
        ...sectionItems,
        ...periodItems,
        ...closerItems,
      ];
    }

    const ranked = (group: Item[], cap = Infinity) =>
      group
        .map((item) => ({ item, rank: matchRank(q, item) }))
        .filter((r) => r.rank > 0)
        .sort((a, b) => b.rank - a.rank)
        .slice(0, cap)
        .map((r) => r.item);

    return [
      ...ranked(callItems, MATCHES),
      ...ranked(closerItems),
      ...ranked(periodItems),
      ...ranked(sectionItems),
    ];
  }, [query, calls, closers, sections, dateRange, selectedCloser, onJump, onPeriod, onCloser, onOpenCall]);

  // A shorter list after typing must not leave the highlight past its end.
  const current = Math.min(active, Math.max(items.length - 1, 0));

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((current + 1) % Math.max(items.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((current - 1 + items.length) % Math.max(items.length, 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      items[current]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      hide();
    } else if (e.key === "Tab") {
      // The box is modal: Tab would otherwise walk the keyboard out into the
      // dimmed page behind it. Arrows are how you move through the list.
      e.preventDefault();
    }
  };

  const fade = still
    ? {}
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.14 } };
  const rise = still
    ? {}
    : {
        initial: { opacity: 0, y: -8, scale: 0.985 },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -6, scale: 0.99 },
        transition: { duration: 0.16, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
      };

  let lastGroup = "";

  return (
    <>
      <button
        type="button"
        onClick={show}
        aria-label="Search calls, closers and sections"
        className="flex shrink-0 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-2.5 py-1.5 text-[11px] text-zinc-400 shadow-[inset_0_1px_0_#ffffff0a] transition-colors hover:border-white/[0.16] hover:text-zinc-100"
      >
        <Search className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded border border-white/[0.10] bg-white/[0.04] px-1 font-sans text-[11px] text-zinc-400 sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* PORTALLED TO <body>. The trigger lives in the header, and the header's
          backdrop-filter makes it the containing block for anything fixed
          inside it — so the overlay was the header's size and sat in the
          header's layer, under the section rail, with the page beside it
          neither dimmed nor blocked. */}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <div key="palette" className="fixed inset-0 z-[70]">
                <motion.button
                  type="button"
                  aria-label="Close search"
                  tabIndex={-1}
                  onClick={hide}
                  {...fade}
                  className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-[3px]"
                />
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-label="Search the dashboard"
                  {...rise}
                  // Centred with auto margins rather than a translate: the entrance
                  // animation owns this element's transform.
                  className="absolute inset-x-0 top-[12vh] mx-auto w-[min(640px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-white/[0.10] bg-[#16161a]/95 shadow-[0_32px_80px_-20px_#000000,0_0_0_1px_#00000080,inset_0_1px_0_#ffffff12] backdrop-blur-xl"
                >
                  <div className="flex items-center gap-3 border-b border-white/[0.07] px-4">
                    <Search className="h-4 w-4 shrink-0 text-gold-400" strokeWidth={1.75} />
                    <input
                      ref={input}
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setActive(0);
                      }}
                      onKeyDown={onInputKey}
                      placeholder="Find a call, a closer, a section…"
                      role="combobox"
                      aria-expanded="true"
                      aria-controls={listId}
                      aria-activedescendant={items[current] ? `${listId}-${current}` : undefined}
                      className="h-14 min-w-0 flex-1 bg-transparent text-[15px] text-zinc-50 outline-none placeholder:text-zinc-500"
                    />
                    <button
                      type="button"
                      onClick={hide}
                      aria-label="Close"
                      className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-white/[0.08] px-1.5 text-[11px] text-zinc-400 hover:text-zinc-100"
                    >
                      <span className="hidden sm:inline">esc</span>
                      <X className="h-3 w-3 sm:hidden" />
                    </button>
                  </div>

                  <div ref={list} id={listId} role="listbox" className="max-h-[min(60vh,440px)] overflow-y-auto p-2">
                    {items.length === 0 && (
                      <p className="px-3 py-8 text-center t-body text-zinc-400">
                        Nothing on this page matches “{query.trim()}”.
                      </p>
                    )}
                    {items.map((item, i) => {
                      const heading = item.group !== lastGroup ? item.group : null;
                      lastGroup = item.group;
                      const on = i === current;
                      const Icon = item.icon;
                      return (
                        <div key={item.id}>
                          {heading && (
                            <div className="px-3 pb-1.5 pt-3 t-label text-zinc-400 first:pt-1.5">{heading}</div>
                          )}
                          <div
                            id={`${listId}-${i}`}
                            data-index={i}
                            role="option"
                            aria-selected={on}
                            onMouseMove={() => active !== i && setActive(i)}
                            onClick={item.run}
                            className={cn(
                              "relative flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors",
                              on ? "bg-gradient-to-r from-gold-500/[0.14] to-gold-500/[0.03]" : "hover:bg-white/[0.03]"
                            )}
                          >
                            {on && (
                              <span
                                aria-hidden
                                className="absolute left-0 top-[calc(50%-0.5rem)] h-4 w-[2px] rounded-r-full bg-gold-400 shadow-[0_0_10px_1px_#d4af37b3]"
                              />
                            )}
                            <span
                              aria-hidden
                              className={cn(
                                "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
                                on ? "border-gold-500/30 bg-gold-500/10 text-gold-300" : "border-white/[0.07] bg-white/[0.03] text-zinc-400"
                              )}
                            >
                              {item.dot ? (
                                <span className="h-2 w-2 rounded-full" style={{ background: item.dot, boxShadow: `0 0 8px ${item.dot}` }} />
                              ) : (
                                <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={cn("block truncate text-[13px] font-medium", on ? "text-zinc-50" : "text-zinc-200")}>
                                {item.label}
                              </span>
                              {item.detail && (
                                <span className="block truncate text-[11px] text-zinc-400">{item.detail}</span>
                              )}
                            </span>
                            {item.current && <Check className="h-3.5 w-3.5 shrink-0 text-gold-400" strokeWidth={2} />}
                            {on && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-zinc-400" strokeWidth={1.75} />}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Keyboard hints, so not on a phone. */}
              <div className="hidden items-center gap-4 border-t border-white/[0.07] px-4 py-2.5 text-[11px] text-zinc-400 sm:flex">
                    <span className="flex items-center gap-1.5">
                      <Kbd>↑</Kbd>
                      <Kbd>↓</Kbd> to move
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Kbd>↵</Kbd> to open
                    </span>
                    <span className="ml-auto hidden sm:inline">
                      <Kbd>/</Kbd> opens this from anywhere
                    </span>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  );
}

const noopSubscribe = () => () => {};

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[18px] items-center justify-center rounded border border-white/[0.10] bg-white/[0.04] px-1 font-sans text-[11px] text-zinc-300">
      {children}
    </kbd>
  );
}

/** True when a keystroke belongs to a field the reader is typing into. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}
