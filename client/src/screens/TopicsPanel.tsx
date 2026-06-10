import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarDays, ChevronDown, Plus, Trash2, X } from "lucide-react";
import { del, get, patch, post, type GoalItemView, type GoalView } from "../api";
import { fade, staggerOption } from "../motion";
import { MathText } from "../components/Katex";
import { MemoryBar, PrimaryButton, QuietButton } from "../components/widgets";

// Topic (goal) management: rename, redate, delete, and prune what each topic
// covers. Deleting a topic never deletes knowledge — items stay in the system.

export function TopicsPanel({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [goals, setGoals] = useState<GoalView[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, GoalItemView[]>>({});
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await get<{ goals: GoalView[] }>("/api/goals");
    setGoals(r.goals);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const toggleOpen = async (id: string) => {
    if (open === id) {
      setOpen(null);
      return;
    }
    const r = await get<{ items: GoalItemView[] }>(`/api/goals/${id}/items`);
    setItems((m) => ({ ...m, [id]: r.items }));
    setOpen(id);
  };

  const addGoal = async () => {
    if (!newName.trim()) return;
    await post("/api/goals", { name: newName.trim(), targetDate: newDate || null });
    setNewName("");
    setNewDate("");
    await refresh();
    onChanged();
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

  const remove = async (id: string) => {
    await del(`/api/goals/${id}`);
    setConfirming(null);
    setOpen(null);
    await refresh();
    onChanged();
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
      <div className="mx-auto w-full max-w-2xl px-6 py-16">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Topics</h2>
          <button
            onClick={onClose}
            aria-label="close"
            className="rounded-full p-2 text-ink/35 transition-colors hover:bg-ink/5 hover:text-ink/80 dark:text-ink-dark/35 dark:hover:bg-ink-dark/10 dark:hover:text-ink-dark/80"
          >
            <X size={18} />
          </button>
        </div>
        <p className="mt-2 text-sm text-ink/50 dark:text-ink-dark/50">
          Rename, set a date, or remove a topic. Removing a topic keeps its items — only the grouping goes.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <AnimatePresence initial={false}>
            {goals.map((g, gi) => (
              <motion.div
                key={g.id}
                {...staggerOption(gi)}
                exit={{ opacity: 0, transition: { duration: 0.15 } }}
                layout
                className="rounded-2xl border border-ink/10 bg-white/40 p-4 shadow-card dark:border-ink-dark/15 dark:bg-white/[0.03]"
              >
                <div className="flex items-center gap-3">
                  <input
                    defaultValue={g.name}
                    onBlur={(e) => e.target.value !== g.name && rename(g.id, e.target.value)}
                    className="min-w-0 flex-1 bg-transparent font-display text-lg font-medium outline-none"
                  />
                  <label className="flex items-center gap-1.5 text-sm text-ink/45 dark:text-ink-dark/45">
                    <CalendarDays size={14} />
                    <input
                      type="date"
                      defaultValue={g.targetDate?.slice(0, 10) ?? ""}
                      onChange={(e) => redate(g.id, e.target.value)}
                      className="bg-transparent outline-none"
                    />
                  </label>
                  {confirming === g.id ? (
                    <span className="flex items-center gap-2 text-sm">
                      <button onClick={() => remove(g.id)} className="text-red-400 hover:text-red-500">
                        delete
                      </button>
                      <QuietButton onClick={() => setConfirming(null)}>keep</QuietButton>
                    </span>
                  ) : (
                    <button
                      onClick={() => setConfirming(g.id)}
                      aria-label={`delete topic ${g.name}`}
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
                    onClick={() => toggleOpen(g.id)}
                    className="flex items-center gap-1 text-sm text-ink/45 transition-colors hover:text-ink dark:text-ink-dark/45 dark:hover:text-ink-dark"
                  >
                    {g.itemCount} item{g.itemCount === 1 ? "" : "s"}
                    <motion.span animate={{ rotate: open === g.id ? 180 : 0 }} transition={{ duration: 0.18 }}>
                      <ChevronDown size={14} />
                    </motion.span>
                  </button>
                </div>
                <AnimatePresence>
                  {open === g.id && (
                    <motion.ul
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1, transition: { duration: 0.2, ease: "easeOut" } }}
                      exit={{ height: 0, opacity: 0, transition: { duration: 0.15 } }}
                      className="mt-3 flex flex-col gap-1.5 overflow-hidden border-t border-ink/10 pt-3 dark:border-ink-dark/10"
                    >
                      {(items[g.id] ?? []).map((it) => (
                        <li key={it.id} className="group flex items-start gap-2 text-sm leading-snug">
                          <span className="mt-0.5 shrink-0 rounded bg-ink/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink/40 dark:bg-ink-dark/10 dark:text-ink-dark/40">
                            {it.kind}
                          </span>
                          <span className="flex-1 text-ink/70 dark:text-ink-dark/70">
                            <MathText text={it.statement} />
                          </span>
                          <button
                            onClick={() => removeItem(g.id, it.id)}
                            title="Remove from this topic"
                            className="text-ink/25 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100 dark:text-ink-dark/25"
                          >
                            <X size={13} />
                          </button>
                        </li>
                      ))}
                      {(items[g.id] ?? []).length === 0 && (
                        <li className="text-sm text-ink/40 dark:text-ink-dark/40">No items yet.</li>
                      )}
                    </motion.ul>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addGoal()}
            placeholder="New topic, e.g. Organic chemistry"
            className="flex-1 rounded-xl border border-ink/15 bg-white/40 px-4 py-2.5 outline-none transition-colors focus:border-accent dark:border-ink-dark/20 dark:bg-white/[0.03]"
          />
          <input
            type="date"
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded-xl border border-ink/15 bg-white/40 px-4 py-2.5 outline-none focus:border-accent dark:border-ink-dark/20 dark:bg-white/[0.03]"
          />
          <PrimaryButton onClick={addGoal} disabled={!newName.trim()} className="px-5 py-2.5 text-sm">
            <Plus size={15} /> Add topic
          </PrimaryButton>
        </div>
      </div>
    </motion.div>
  );
}
