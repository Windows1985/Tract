import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

/** Number that counts up over 400ms. */
export function CountUp({ value, suffix = "" }: { value: number; suffix?: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(reduced ? value : 0);
  const raf = useRef<number>();
  useEffect(() => {
    if (reduced) {
      setShown(value);
      return;
    }
    const start = performance.now();
    const from = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 400);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current!);
  }, [value, reduced]);
  return (
    <span>
      {shown}
      {suffix}
    </span>
  );
}

/** Thin memory bar that fills over 500ms ease-out. */
export function MemoryBar({ percent }: { percent: number }) {
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-ink/10 dark:bg-ink-dark/15">
      <motion.div
        className="h-full rounded-full bg-accent/70"
        initial={{ width: 0 }}
        animate={{ width: `${percent}%` }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </div>
  );
}

/** Countdown timer ring (SVG) for the free-recall sweep. */
export function TimerRing({ seconds, total }: { seconds: number; total: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, seconds / total);
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="3" className="stroke-ink/10 dark:stroke-ink-dark/15" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="3"
        strokeLinecap="round"
        className="stroke-accent transition-[stroke-dashoffset] duration-1000 ease-linear"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
      />
    </svg>
  );
}

/** Minimal pulse-fade placeholder shown if probe generation is slow. */
export function PulsePlaceholder() {
  return (
    <div className="flex w-full flex-col gap-3 py-12" aria-label="loading">
      <motion.div
        className="h-4 w-3/4 rounded bg-ink/10 dark:bg-ink-dark/15"
        animate={{ opacity: [0.4, 0.9, 0.4] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        className="h-4 w-1/2 rounded bg-ink/10 dark:bg-ink-dark/15"
        animate={{ opacity: [0.4, 0.9, 0.4] }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
      />
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full bg-accent px-8 py-3 text-base font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function QuietButton({
  children,
  onClick,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-sm text-ink/50 underline-offset-4 transition-colors hover:text-ink dark:text-ink-dark/50 dark:hover:text-ink-dark ${className}`}
    >
      {children}
    </button>
  );
}
