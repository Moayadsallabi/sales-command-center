"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  PanelLeftClose,
  PanelLeftOpen,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ONE ENTRY IN THE RAIL. `id` is the id of the element on the page, so the
 * link and the scroll-spy read the same string and a renamed section cannot
 * highlight one thing and jump to another.
 */
export type NavSection = {
  id: string;
  label: string;
  icon: LucideIcon;
};

/** Width of the rail in each state. Kept here so the nav and the page padding
 *  that makes room for it are written down once. */
export const NAV_WIDTH = { open: "14rem", closed: "3.5rem" } as const;

const STORAGE_KEY = "scc.section-nav.collapsed";

/**
 * Collapsed state, remembered between visits.
 *
 * It lives in the page rather than in the rail because the page has to leave a
 * gap the exact width of the rail — the rail is fixed to the viewport so that
 * it survives scrolling, and a fixed element takes up no space of its own.
 *
 * Held outside React and read through `useSyncExternalStore` because the
 * server cannot know what this browser chose last time. That hook is built for
 * exactly this shape: it hydrates against `getServerSnapshot` — the same value
 * the HTML was rendered with — and only then re-reads the browser's own
 * answer, so the first paint never disagrees with what was sent.
 */
let stored: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (stored === null) {
    try {
      stored = window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private browsing, or storage turned off. The default stands.
      stored = false;
    }
  }
  return stored;
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useSectionNav() {
  const collapsed = useSyncExternalStore(subscribe, read, () => false);

  const toggle = useCallback(() => {
    stored = !read();
    try {
      window.localStorage.setItem(STORAGE_KEY, stored ? "1" : "0");
    } catch {}
    listeners.forEach((l) => l());
  }, []);

  return { collapsed, toggle };
}

/**
 * WHICH SECTION IS ON SCREEN.
 *
 * Deliberately not an IntersectionObserver. Several panels on this page are
 * taller than the viewport and several are shorter than the sticky header is
 * tall, and an observer answers "is any of it visible", which for those two
 * shapes lights up two entries at once or none. This asks the only question
 * the rail is actually answering: which section heading did the reader last
 * scroll past.
 *
 * `OFFSET` is the sticky header — a section is "reached" when its top passes
 * under the header, not when it touches the top of the window, otherwise the
 * highlight moves a header's height before the section is readable.
 */
const OFFSET = 150;

function useActiveSection(sections: NavSection[]): string | null {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;

      // The last section can be shorter than the gap left under it, so it can
      // never reach the top of the window. At the bottom of the page it is
      // what you are looking at, whatever the arithmetic below says.
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 8;
      if (atBottom) {
        setActive(sections[sections.length - 1]?.id ?? null);
        return;
      }

      let current: string | null = sections[0]?.id ?? null;
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - OFFSET <= 0) current = s.id;
      }
      setActive(current);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sections]);

  return active;
}

/**
 * The section rail.
 *
 * The page grew from four panels to ten, and the only way to reach the call
 * table or the data-health band was to scroll the whole thing. This is a list
 * of where you can go, always on screen, collapsible to icons when the
 * numbers matter more than the map.
 *
 * Below `lg` it is a button and a drawer instead of a rail: there is no room
 * for a permanent column beside a page whose tables already scroll sideways.
 */
export function SectionNav({
  sections,
  collapsed,
  onToggle,
}: {
  sections: NavSection[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const active = useActiveSection(sections);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const still = useReducedMotion();

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  /**
   * Jumping by hand rather than letting the browser follow the href, for two
   * reasons: the highlight moves the moment you click instead of after the
   * scroll settles, and `#id` in the address bar would restore the page
   * halfway down on the next refresh — this dashboard reloads itself every
   * sixty seconds.
   */
  const go = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
    setDrawerOpen(false);
  }, []);

  /**
   * THE RAIL'S LINKS, and the gold marker that says which section you are in.
   *
   * `scope` namespaces the marker's `layoutId`, and it is not decoration: the
   * desktop rail and the phone drawer both render this list, and on a narrow
   * screen the desktop one is still in the document — merely `display: none`.
   * Two live elements sharing one layoutId make framer-motion animate the
   * marker between two rails that are not both on screen, which reads as the
   * highlight vanishing. One id per rail, so each animates within itself.
   */
  const renderList = (scope: string) => (
    <ul className="flex flex-col gap-0.5">
      {sections.map((s) => {
        const Icon = s.icon;
        const on = active === s.id;
        return (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={(e) => {
                e.preventDefault();
                go(s.id);
              }}
              aria-current={on ? "true" : undefined}
              title={collapsed ? s.label : undefined}
              className={cn(
                "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12px] font-medium transition-colors",
                // Collapsed, the label is REMOVED rather than faded: a
                // zero-opacity span still takes its width, which pushed the
                // icons off-centre in a 3.5rem rail and overflowed it.
                collapsed && "lg:justify-center lg:px-0",
                on
                  ? "bg-gold-500/10 text-gold-400"
                  : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-100"
              )}
            >
              {/* The bar is what makes the current section readable at a
                  glance in the collapsed rail, where the label is gone and a
                  gold icon on its own is easy to miss.

                  It used to exist on every link and cross-fade between them,
                  which at a glance looks like one bar blinking out and another
                  blinking in somewhere else. Now there is exactly ONE bar and
                  it travels: framer-motion matches the old position to the new
                  by `layoutId` and animates between them, so scrolling down
                  the page slides the marker down the rail.

                  Centred with `top` rather than `-translate-y-1/2`, because
                  the layout animation writes this element's transform itself
                  and a Tailwind translate class would be overwritten mid-move. */}
              {on &&
                (still ? (
                  <span
                    aria-hidden
                    className="absolute left-0 top-[calc(50%-0.5rem)] h-4 w-[2px] rounded-r-full bg-gold-500"
                  />
                ) : (
                  <motion.span
                    aria-hidden
                    layoutId={`${scope}-section-marker`}
                    className="absolute left-0 top-[calc(50%-0.5rem)] h-4 w-[2px] rounded-r-full bg-gold-500"
                    // Stiff and well damped: it arrives with the scroll rather
                    // than trailing it, and never overshoots into the link
                    // above or below.
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                ))}
              <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className={cn("truncate", collapsed && "lg:hidden")}>
                {s.label}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      {/* ------------------------------------------------ desktop rail */}
      <nav
        aria-label="Sections"
        style={{ width: collapsed ? NAV_WIDTH.closed : NAV_WIDTH.open }}
        className="shell-offset-top fixed inset-y-0 left-0 z-50 hidden flex-col border-r border-white/[0.06] bg-[#0b0b0e] transition-[width] duration-200 lg:flex"
      >
        {/* Its own row, the same height as the page header beside it, so the
            rail and the page start on the same line. */}
        <div
          className={cn(
            "flex h-[57px] shrink-0 items-center border-b border-white/[0.06]",
            collapsed ? "justify-center px-0" : "px-2.5"
          )}
        >
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Expand sections" : "Collapse sections"}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-white/[0.05] hover:text-zinc-200"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" strokeWidth={1.5} />
            ) : (
              <PanelLeftClose className="h-4 w-4" strokeWidth={1.5} />
            )}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {!collapsed && (
            <div className="px-2.5 pb-1.5 t-label text-zinc-500">Sections</div>
          )}
          {renderList("rail")}
        </div>
      </nav>

      {/* ------------------------------------------------ narrow screens */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open sections"
        className="fixed bottom-4 left-4 z-50 flex h-11 w-11 items-center justify-center rounded-full border border-white/[0.10] bg-[#141418] text-zinc-300 shadow-2xl transition-colors hover:text-gold-400 lg:hidden"
      >
        <Menu className="h-4 w-4" strokeWidth={1.5} />
      </button>

      {/* The drawer SLIDES IN FROM THE EDGE IT LIVES ON, which is the whole
          reason it animates at all: appearing instantly, a full-height panel
          over the page is indistinguishable from the page having navigated
          somewhere. A fifth of a second of travel says it came in over the
          top and will go back. The dimming behind it fades on the same beat.

          `exit` is why this is wrapped in AnimatePresence rather than driven
          by a class — React would otherwise remove the drawer from the page
          the instant it closes and there would be nothing left to animate. */}
      <AnimatePresence>
        {drawerOpen && (
        // Keyed because AnimatePresence tracks its direct children by key to
        // know which one is leaving; it then holds this whole subtree in the
        // page until the two exits inside it have finished.
        <div key="sections-drawer" className="fixed inset-0 z-50 lg:hidden">
          <motion.button
            type="button"
            aria-label="Close sections"
            onClick={() => setDrawerOpen(false)}
            {...(still
              ? {}
              : {
                  initial: { opacity: 0 },
                  animate: { opacity: 1 },
                  exit: { opacity: 0 },
                  transition: { duration: 0.18 },
                })}
            className="absolute inset-0 cursor-default bg-black/60 backdrop-blur-sm"
          />
          <motion.nav
            aria-label="Sections"
            {...(still
              ? {}
              : {
                  initial: { x: "-100%" },
                  animate: { x: 0 },
                  exit: { x: "-100%" },
                  transition: {
                    duration: 0.2,
                    ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
                  },
                })}
            className="shell-offset-top absolute inset-y-0 left-0 flex w-[15rem] flex-col border-r border-white/[0.06] bg-[#0b0b0e]"
          >
            <div className="flex h-[57px] shrink-0 items-center justify-between border-b border-white/[0.06] px-3">
              <span className="t-label text-zinc-500">Sections</span>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close sections"
                className="text-zinc-500 transition-colors hover:text-zinc-200"
              >
                <X className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {renderList("drawer")}
            </div>
          </motion.nav>
        </div>
        )}
      </AnimatePresence>
    </>
  );
}
