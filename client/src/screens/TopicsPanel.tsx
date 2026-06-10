import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronDown, Pencil, Trash2, X } from "lucide-react";
import { del, get, patch, post, type GoalItemView, type GoalView } from "../api";
import { fade, staggerOption } from "../motion";
import { MathText } from "../components/Katex";
import { MemoryBar, QuietButton } from "../components/widgets";

// Category & topic management. Categories are goals; topics are the AI's
// subtopic labels on items (e.g. Chemistry → Redox, Electrolysis). Removing
// either takes the material out of study (items are archived, not deleted —
// they can be restored from the item browser behind the gear).

export function TopicsPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [goals, setGoals] = useState<GoalView[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, GoalItemView[]>>({});
  const [confirming, setConfirming] = useState<string | null>(null); // goal id or `${goalId}::${topic}`
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await get<{ goals: GoalView[] }>("/api/goals");
    setGoals(r.goals);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadItems = useCallback(async (id: string) => {
    const r = await get<{ items: GoalItemView[] }>(`/api/goals/${id}/items`);
    setItems((m) => ({ ...m, [id]: r.items }));
  }, []);

  const toggleOpen = async (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    await loadItems(id);
    setOpen(id);
  };

  const rename = async (id: string, name: string) => {
    if (!name.trim()) return;
    await patch(`/api/goals/${id}`, { name: name.trim() });
    await refresh();
    onChanged();
  };

  const redate = async (id: string, date: string) => {
    await patch(`/api/goals/${id}`, { targetDate: date || null });
    await refresh();
    onChanged();
  };

  const removeGoal = async (id: string) => {
    setBusy(id);
    try {
      await del(`/api/goals/${id}`);
      setGoals((gs) => gs.filter((g) => g.id !== id)); // optimistic — disappears immediately
      setConfirming(null);
      if (open === id) setOpen(null);
      await refresh();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const removeTopic = async (goalId: string, topic: string) => {
    setBusy(`${goalId}::${topic}`);
    try {
      await post(`/api/goals/${goalId}/topics/archive`, { topic });
      setConfirming(null);
      await loadItems(goalId);
      await refresh();
      onChanged();
    } finally {
      setBusy(null);
    }
  };

  const removeItem = async (goalId: string, itemId: string) => {
    await del(`/api/goals/${goalId}/items/${itemId}`);
    setItems((m) => ({ ...m, [goalId]: (m[goalId] ?? []).filter((i) => i.id !== itemId) }));
    await refresh();
    onChanged();
  };

  return (
    <motion.div
      {...fade}
      className="fixed inset-0 z-10 overflow-y-auto bg-paper/95 backdrop-blur-sm dark:bg-paper-dark/95"
    >
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Topics</h2>
          <button
            onClick={onClose}
            aria-label="close"
            className="rounded-full p-2 text-ink/35 transition-colors hover:bg-ink/5 hover:text-ink/80 dark:text-ink-dark/35 dark:hover:bg-ink-dark/10 dark:hover:text-ink-dark/80"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink/50 dark:text-ink-dark/50">
          Each category holds the topics found in your material. Click a name or date to edit it. Removing a
          topic or category archives its items (restorable from the item browser in settings). New categories
          are created when you add material.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {goals.length === 0 && (
            <p className="text-sm text-ink/40 dark:text-ink-dark/40">
              No categories yet — they're created when you add material from Home.
            </p>
          )}
          <AnimatePresence initial={false}>
            {goals.map((g, gi) => (
              <GoalCard
                key={g.id}
                goal={g}
                index={gi}
                open={open === g.id}
                items={items[g.id] ?? []}
                confirming={confirming}
                busy={busy}
                onToggle={() => toggleOpen(g.id)}
                onRename={(name) => rename(g.id, name)}
                onRedate={(date) => redate(g.id, date)}
                onConfirm={setConfirming}
                onRemoveGoal={() => removeGoal(g.id)}
                onRemoveTopic={(topic) => removeTopic(g.id, topic)}
                onRemoveItem={(itemId) => removeItem(g.id, itemId)}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

function GoalCard({
  goal: g,
  index,
  open,
  items,
  confirming,
  busy,
  onToggle,
  onRename,
  onRedate,
  onConfirm,
  onRemoveGoal,
  onRemoveTopic,
  onRemoveItem,
}: {
  goal: GoalView;
  index: number;
  open: boolean;
  items: GoalItemView[];
  confirming: string | null;
  busy: string | null;
  onToggle: () => void;
  onRename: (name: string) => void;
  onRedate: (date: string) => void;
  onConfirm: (key: string | null) => void;
  onRemoveGoal: () => void;
  onRemoveTopic: (topic: string) => void;
  onRemoveItem: (itemId: string) => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  const topics = useMemo(() => {
    const groups = new Map<string, GoalItemView[]>();
    for (const it of items) {
      const t = it.topic?.trim() || "General";
      groups.set(t, [...(groups.get(t) ?? []), it]);
    }
    return [...groups.entries()];
  }, [items]);

  return (
    <motion.div
      {...staggerOption(Math.min(index, 8))}
      exit={{ opacity: 0, height: 0, transition: { duration: 0.2 } }}
      layout
      className="overflow-hidden rounded-2xl border border-ink/10 bg-white/40 p-4 shadow-card dark:border-ink-dark/15 dark:bg-white/[0.03]"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <span className="group/name flex min-w-[10rem] flex-1 items-center gap-1.5">
          <input
            ref={nameRef}
            defaultValue={g.name}
            onBlur={(e) => e.target.value !== g.name && onRename(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            aria-label="Category name"
            className="-mx-2 min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 font-display text-lg font-medium outline-none transition-colors hover:bg-ink/[0.04] focus:bg-ink/[0.04] focus:ring-2 focus:ring-accent/30 dark:hover:bg-ink-dark/[0.06] dark:focus:bg-ink-dark/[0.06]"
          />
          <button
            onClick={() => nameRef.current?.focus()}
            aria-label={`rename ${g.name}`}
            className="shrink-0 rounded-full p-1 text-ink/25 transition-colors hover:bg-ink/5 hover:text-ink/60 group-focus-within/name:text-accent dark:text-ink-dark/25 dark:hover:bg-ink-dark/10 dark:hover:text-ink-dark/60"
          >
            <Pencil size={13} />
          </button>
        </span>
        <label
          title="Target date"
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-ink/45 transition-colors hover:bg-ink/[0.04] focus-within:bg-ink/[0.04] focus-within:ring-2 focus-within:ring-accent/30 dark:text-ink-dark/45 dark:hover:bg-ink-dark/[0.06]"
        >
          <CalendarDays size={14} className="shrink-0" />
          <input
            type="date"
            defaultValue={g.targetDate?.slice(0, 10) ?? ""}
            onChange={(e) => onRedate(e.target.value)}
            aria-label="Target date"
            className="w-[8.5rem] cursor-pointer bg-transparent outline-none"
          />
        </label>
        {confirming === g.id ? (
          <span className="flex items-center gap-2 text-sm">
            <button
              onClick={onRemoveGoal}
              disabled={busy === g.id}
              className="rounded-full bg-red-400/10 px-3 py-1 font-medium text-red-400 hover:bg-red-400/20 disabled:opacity-50"
            >
              {busy === g.id ? "removing…" : "remove category"}
            </button>
            <QuietButton onClick={() => onConfirm(null)}>keep</QuietButton>
          </span>
        ) : (
          <button
            onClick={() => onConfirm(g.id)}
            aria-label={`delete category ${g.name}`}
            className="rounded-full p-1.5 text-ink/30 transition-colors hover:bg-red-400/10 hover:text-red-400 dark:text-ink-dark/30"
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div className="flex-1">
          <MemoryBar percent={g.memory} />
        </div>
        <button
          onClick={onToggle}
          className="flex shrink-0 items-center gap-1 text-sm text-ink/45 transition-colors hover:text-ink dark:text-ink-dark/45 dark:hover:text-ink-dark"
        >
          {g.itemCount} item{g.itemCount === 1 ? "" : "s"}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.18 }}>
            <ChevronDown size={14} />
          </motion.span>
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1, transition: { duration: 0.22, ease: "easeOut" } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-col gap-4 border-t border-ink/10 pt-3 dark:border-ink-dark/10">
              {topics.length === 0 && <p className="text-sm text-ink/40 dark:text-ink-dark/40">No items yet.</p>}
              {topics.map(([topic, topicItems]) => {
                const cKey = `${g.id}::${topic}`;
                return (
                  <div key={topic}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-display text-sm font-semibold uppercase tracking-wider text-accent">
                        {topic}
                      </span>
                      <span className="text-xs text-ink/35 dark:text-ink-dark/35">
                        {topicItems.length} item{topicItems.length === 1 ? "" : "s"}
                      </span>
                      {confirming === cKey ? (
                        <span className="flex items-center gap-2 text-xs">
                          <button
                            onClick={() => onRemoveTopic(topic)}
                            disabled={busy === cKey}
                            className="rounded-full bg-red-400/10 px-2.5 py-0.5 font-medium text-red-400 hover:bg-red-400/20 disabled:opacity-50"
                          >
                            {busy === cKey ? "removing…" : "remove topic"}
                          </button>
                          <QuietButton onClick={() => onConfirm(null)}>keep</QuietButton>
                        </span>
                      ) : (
                        <button
                          onClick={() => onConfirm(cKey)}
                          aria-label={`remove topic ${topic}`}
                          className="rounded-full p-1 text-ink/25 transition-colors hover:bg-red-400/10 hover:text-red-400 dark:text-ink-dark/25"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {topicItems.map((it) => (
                        <li key={it.id} className="group flex items-start gap-2 text-sm leading-snug">
                          <span className="mt-0.5 shrink-0 rounded bg-ink/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink/40 dark:bg-ink-dark/10 dark:text-ink-dark/40">
                            {it.kind}
                          </span>
                          <span className="min-w-0 flex-1 text-ink/70 dark:text-ink-dark/70">
                            <MathText text={it.statement} />
                          </span>
                          <button
                            onClick={() => onRemoveItem(it.id)}
                            title="Remove from this category"
                            className="text-ink/25 transition-colors hover:text-red-400 group-hover:text-ink/50 dark:text-ink-dark/25 sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <X size={13} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
