"use client";

import { useEffect } from "react";

const CARDS = ".glass-card, .money-card";

/**
 * Light that follows the mouse across the cards.
 *
 * Writes the pointer's position inside whichever card it is over as two
 * custom properties, `--mx` and `--my`, which the card's own background reads
 * (see `.glass-card` in globals.css). Nothing is rendered here and no card has
 * to know about it: a card is lit because it is a card.
 *
 * One listener for the whole page rather than one per card, coalesced to one
 * write per frame. Leaving a card clears its properties so its light goes out
 * rather than staying where the pointer left it.
 *
 * Mouse only. A finger has no hover, and on a phone the light would land
 * wherever the last tap was and stay there.
 */
export function useSpotlight() {
  useEffect(() => {
    let lit: HTMLElement | null = null;
    let frame = 0;
    let pending: { el: HTMLElement | null; x: number; y: number } | null = null;

    const clear = () => {
      if (!lit) return;
      lit.style.removeProperty("--mx");
      lit.style.removeProperty("--my");
      lit = null;
    };

    const paint = () => {
      frame = 0;
      if (!pending) return;
      const { el, x, y } = pending;
      pending = null;
      if (el !== lit) clear();
      if (!el) return;
      const box = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${x - box.left}px`);
      el.style.setProperty("--my", `${y - box.top}px`);
      lit = el;
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const target = e.target instanceof Element ? e.target : null;
      pending = {
        el: (target?.closest(CARDS) as HTMLElement | null) ?? null,
        x: e.clientX,
        y: e.clientY,
      };
      if (!frame) frame = requestAnimationFrame(paint);
    };

    document.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", clear);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", clear);
      clear();
    };
  }, []);
}
