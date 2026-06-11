import { useState } from "react";
import { motion } from "framer-motion";
import type { HomeView } from "../api";
import { fade, staggerOption } from "../motion";
import { GearSix, MemoryBar, PrimaryButton, QuietButton } from "../components/widgets";

// One dominant element: today's minutes + Start. One row per goal. A quiet
// add-material link. A footer gear. Nothing else.

export function Home({
  home,
  demoMode,
  onStart,
  onAddMaterial,
  onOpenSettings,
  onManageTopics,
}: {
  home: HomeView;
  demoMode: boolean;
  onStart: () => void;
  onAddMaterial: () => void;
  onOpenSettings: () => void;
  onManageTopics: () => void;
}) {
  const [today] = useState(() =>
    new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
  );
  const [resumable] = useState(() => localStorage.getItem("tract.activeSession") !== null);

  return (
    <motion.div {...fade} className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-4 py-10 sm:px-6 sm:py-16">
      <div className="flex items-baseline justify-between">
        <span className="font-display text-lg font-semibold tracking-tight text-ink/70 dark:text-ink-dark/60">Tract</span>
        <p className="text-sm text-ink/40 dark:text-ink-dark/40">{today}</p>
      </div>

      <div className="mt-20 flex flex-col items-center text-center">
        <p className="font-display text-3xl text-ink/80 dark:text-ink-dark/80">
          Today: ~{Math.max(1, home.estimatedMinutes)} min
        </p>
        {home.dueCount > 0 && (
          <p className="mt-1.5 text-sm text-ink/40 dark:text-ink-dark/40">
            {home.dueCount} probe{home.dueCount === 1 ? "" : "s"} waiting
          </p>
        )}
        <PrimaryButton onClick={onStart} className="mt-8 px-16 py-4 text-lg">
          {resumable ? "Resume" : "Start"}
        </PrimaryButton>
        {demoMode && <p className="mt-4 text-xs uppercase tracking-[0.25em] text-amber-500/80">demo mode</p>}
      </div>

      <div className="mt-24 flex flex-col gap-7">
        {home.goals.map((g, i) => (
          <motion.div key={g.id} {...staggerOption(i)}>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-display text-lg">{g.name}</span>
              <span className="text-sm tabular-nums text-ink/50 dark:text-ink-dark/50">
                {g.projected !== null && g.targetDate
                  ? `~${g.projected}% on ${new Date(g.targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : `${g.memory}%`}
              </span>
            </div>
            <MemoryBar percent={g.memory} />
          </motion.div>
        ))}
      </div>

      <div className="mt-14 flex items-center gap-6">
        <QuietButton onClick={onAddMaterial}>+ Add material</QuietButton>
        <QuietButton onClick={onManageTopics}>manage topics</QuietButton>
      </div>

      <footer className="mt-auto flex justify-end pt-16">
        <button
          onClick={onOpenSettings}
          aria-label="settings"
          className="rounded p-2 text-ink/30 transition-colors hover:bg-ink/5 hover:text-ink/60 dark:text-ink-dark/30 dark:hover:bg-ink-dark/10 dark:hover:text-ink-dark/60"
        >
          <GearSix size={18} />
        </button>
      </footer>
    </motion.div>
  );
}
