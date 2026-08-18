"use client";

import { useEffect, useState } from "react";
import { motion, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { formatReporting } from "@/lib/money";

interface AnimatedNumberProps {
  value: number;
  format?: "number" | "currency" | "percent";
  className?: string;
}

/**
 * A figure that MOVES when it changes, and is simply correct when it does not.
 *
 * This used to count up from zero on every mount, gated behind
 * `useInView(..., { once: true })`. Two problems, and the second is the
 * serious one:
 *
 * 1. The count-up is a delay in front of the answer. On the headline cash tile
 *    it took over a second to arrive at a number the server already knew, on a
 *    page someone opens twenty times a day.
 *
 * 2. Gating it on an IntersectionObserver meant the tile rendered $0 until the
 *    observer fired. In a background tab, a hidden pane, or anywhere the
 *    callback is deferred, the dashboard sat there showing zero — which is not
 *    a missing number, it is a WRONG one, and on this page of all pages that is
 *    the fault worth avoiding. A figure that has not loaded must never look
 *    like a figure that is nought.
 *
 * So the spring is seeded WITH the value: mounting animates nothing, and the
 * server-rendered markup matches what hydration produces. The animation is
 * kept for the case where it earns its keep — the date range moving, a filter
 * landing, the 60-second refresh bringing in a new call — where seeing the
 * number travel tells you it changed.
 */
export function AnimatedNumber({
  value,
  format = "number",
  className,
}: AnimatedNumberProps) {
  const still = useReducedMotion();
  const spring = useSpring(value, { stiffness: 170, damping: 26, mass: 0.8 });
  const display = useTransform(spring, (v) => formatValue(v, format));
  const [rendered, setRendered] = useState(formatValue(value, format));

  useEffect(() => {
    if (still) spring.jump(value);
    else spring.set(value);
  }, [value, spring, still]);

  useEffect(() => {
    const unsub = display.on("change", (v) => setRendered(v));
    return unsub;
  }, [display]);

  return (
    <motion.span className={className} suppressHydrationWarning>
      {rendered}
    </motion.span>
  );
}

function formatValue(v: number, format: string): string {
  const rounded = Math.round(v);
  switch (format) {
    // Every currency KPI is a total across calls, so it has already been
    // converted into the reporting currency by the money helpers.
    case "currency":
      return formatReporting(rounded);
    case "percent":
      return `${rounded}%`;
    default:
      return rounded.toLocaleString();
  }
}
