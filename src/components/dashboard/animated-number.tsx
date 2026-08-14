"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useSpring, useTransform } from "framer-motion";
import { formatReporting } from "@/lib/money";

interface AnimatedNumberProps {
  value: number;
  format?: "number" | "currency" | "percent";
  className?: string;
}

export function AnimatedNumber({
  value,
  format = "number",
  className,
}: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true });
  const spring = useSpring(0, { stiffness: 60, damping: 20, mass: 1 });
  const display = useTransform(spring, (v) => formatValue(v, format));
  const [rendered, setRendered] = useState(formatValue(0, format));

  useEffect(() => {
    if (isInView) {
      spring.set(value);
    }
  }, [isInView, value, spring]);

  useEffect(() => {
    const unsub = display.on("change", (v) => setRendered(v));
    return unsub;
  }, [display]);

  return (
    <motion.span ref={ref} className={className}>
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
