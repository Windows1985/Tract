import { useState } from "react";
import { motion } from "framer-motion";
import type { HomeView } from "../api";
import { fade } from "../motion";
import { MemoryBar, PrimaryButton, QuietButton } from "../components/widgets";

// One dominant element: today's minutes + Start. One row per goal. A quiet
// add-material link. A footer gear. Nothing else.

export function Home({
  home,
  demoMode,
  onStart,
  onAddMaterial,
  onOpenSettings,
}: {
  home: HomeView;
  demoMode: boolean;
  onStart: () => void;
  onAddMaterial: () => void;
  onOpenSettings: () => void;
}) {
  const [today] = useState(() => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }));

  return (
    <motion.div {...fade} className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-16">
      <p className="text-sm text-ink/40 dark:text-ink-dark/40">{today}</p>

      <div className="mt-16 flex flex-col items-center text-center">
        <p className="text-2xl text-ink/70 dark:text-ink-dark/70">
          Today: ~{Math.max(1, home.estimatedMinutes)} min
        </p>
        <PrimaryButton onClick={onStart} className="mt-6 px-14 py-4 text-lg">
          Start
        </PrimaryButton>
        {demoMode && (
          <p className="mt-3 text-xs uppercase tracking-widest text-amber-500/80">demo mode</p>
        )}
      </div>

      <div className="mt-20 flex flex-col gap-6">
        {home.goals.map((g) => (
          <div key={g.id}>
            <div className="mb-2 flex items-baseline justify-between">
              <span>{g.name}</span>
              <span className="text-sm tabular-nums text-ink/50 dark:text-ink-dark/50">
                {g.projected !== null && g.targetDate
                  ? `~${g.projected}% on ${new Date(g.targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : `${g.memory}%`}
              </span>
            </div>
            <MemoryBar percent={g.memory} />
          </div>
        ))}
      </div>

      <div className="mt-12">
        <QuietButton onClick={onAddMaterial}>+ Add material</QuietButton>
      </div>

      <footer className="mt-auto flex justify-end pt-16">
        <button
          onClick={onOpenSettings}
          aria-label="settings"
          className="text-ink/30 transition-colors hover:text-ink/70 dark:text-ink-dark/30 dark:hover:text-ink-dark/70"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </footer>
    </motion.div>
  );
}
