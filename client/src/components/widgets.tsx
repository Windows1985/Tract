import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowsClockwise, GearSix } from "@phosphor-icons/react";

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
    <div className="h-px w-full overflow-hidden bg-ink/10 dark:bg-ink-dark/15">
      <motion.div
        className="h-full bg-accent"
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
      <circle cx="32" cy="32" r={r} fill="none" strokeWidth="2" className="stroke-ink/8 dark:stroke-ink-dark/12" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="butt"
        className="stroke-accent transition-[stroke-dashoffset] duration-1000 ease-linear"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - frac)}
      />
    </svg>
  );
}

/**
 * Minimal waveform thinking indicator — three vertical bars that pulse in
 * height, quieter and more editorial than three bouncing dots.
 */
export function Thinking({ label }: { label?: string }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex items-center gap-3 text-ink/50 dark:text-ink-dark/50">
      <span className="flex items-center gap-[3px]" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="block w-[2px] rounded-[1px] bg-accent/60"
            animate={reduced ? undefined : { height: [5, 13, 5] }}
            style={{ height: 5 }}
            transition={{ duration: 0.8, repeat: Infinity, ease: "easeInOut", delay: i * 0.13 }}
          />
        ))}
      </span>
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

/** Inline spinner — a thin rotating arc, no icon library needed. */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span className={`${className} inline-block`} aria-label="loading">
      <ArrowsClockwise className="h-full w-full animate-spin" weight="regular" />
    </span>
  );
}

/**
 * Probe loading state: a horizontal bar that breathes and a label below.
 * Replaces the concentric orb — still communicates "generating" without
 * the AI-generic pulse-circle look.
 */
export function PulsePlaceholder({ label = "composing your next probe" }: { label?: string }) {
  const reduced = useReducedMotion();
  return (
    <div className="flex w-full flex-col items-center gap-8 py-16" aria-label="loading">
      <div className="relative h-px w-32 overflow-hidden bg-ink/8 dark:bg-ink-dark/10">
        <motion.div
          className="absolute inset-y-0 left-0 bg-accent"
          animate={reduced ? undefined : { left: ["-100%", "100%"] }}
          style={{ width: "40%" }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      <Thinking label={label} />
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
  className = "",
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
}) {
  return (
    <motion.button
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.98 }}
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded bg-accent px-8 py-3 text-base font-medium tracking-[-0.01em] text-white transition-[opacity,background-color] hover:bg-accent/90 disabled:opacity-40 ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </motion.button>
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
      className={`text-sm text-ink/45 underline-offset-4 transition-colors hover:text-ink dark:text-ink-dark/45 dark:hover:text-ink-dark ${className}`}
    >
      {children}
    </button>
  );
}

/** Settings gear icon re-exported for use in screens without importing Phosphor directly. */
export { GearSix };
