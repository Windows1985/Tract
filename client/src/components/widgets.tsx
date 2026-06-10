import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";

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
        className="h-full rounded-full bg-gradient-to-r from-accent-soft to-accent"
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

/**
 * Three-dot thinking indicator — the app's standard "the AI is working"
 * signal. Quiet, rhythmic, never a blocking overlay.
 */
export function Thinking({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-ink/50 dark:text-ink-dark/50">
      <span className="flex items-end gap-1" aria-hidden>
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="block h-1.5 w-1.5 rounded-full bg-accent"
            animate={{ y: [0, -5, 0], opacity: [0.4, 1, 0.4] }}
            transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut", delay: i * 0.14 }}
          />
        ))}
      </span>
      {label && <span className="text-sm">{label}</span>}
    </div>
  );
}

/** Inline spinner for buttons / option rows. */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <Loader2 className={`${className} animate-spin`} aria-label="loading" />;
}

/**
 * Full-bleed probe loading state: a breathing orb with a thinking label.
 * Shown when the next probe hasn't finished generating — should be rare,
 * since probes are pre-fetched.
 */
export function PulsePlaceholder({ label = "composing your next probe" }: { label?: string }) {
  return (
    <div className="flex w-full flex-col items-center gap-6 py-16" aria-label="loading">
      <div className="relative h-20 w-20">
        <motion.div
          className="absolute inset-0 rounded-full bg-accent/15"
          animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute inset-3 rounded-full bg-accent/20"
          animate={{ scale: [1, 1.18, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute inset-6 rounded-full bg-gradient-to-br from-accent-soft to-accent shadow-glow"
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
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
      whileTap={disabled ? undefined : { scale: 0.97 }}
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-2 rounded-full bg-accent px-8 py-3 text-base font-medium text-white shadow-glow transition-[opacity,box-shadow] hover:shadow-[0_10px_40px_-8px_rgba(92,95,196,0.6)] disabled:opacity-40 disabled:shadow-none ${className}`}
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
      className={`text-sm text-ink/50 underline-offset-4 transition-colors hover:text-ink dark:text-ink-dark/50 dark:hover:text-ink-dark ${className}`}
    >
      {children}
    </button>
  );
}
