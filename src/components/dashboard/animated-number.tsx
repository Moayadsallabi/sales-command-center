"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useSpring, useTransform } from "framer-motion";

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
    case "currency":
      return `$${rounded.toLocaleString()}`;
    case "percent":
      return `${rounded}%`;
    default:
      return rounded.toLocaleString();
  }
}
