import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Download, Upload, X } from "lucide-react";
import { get, patch, post, type SettingsView } from "../api";
import { fade } from "../motion";
import { MathText } from "../components/Katex";
import { PrimaryButton, QuietButton } from "../components/widgets";

interface ItemRow {
  id: string;
  statement: string;
  kind: string;
  topic: string;
  archived: boolean;
}

const fieldClass =
  "rounded-xl border border-ink/15 bg-white/40 px-4 py-2.5 outline-none transition-colors focus:border-accent dark:border-ink-dark/20 dark:bg-white/[0.03]";

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium uppercase tracking-[0.15em] text-ink/40 dark:text-ink-dark/40">{children}</p>
  );
}

export function SettingsSheet({
  settings,
  onClose,
  onChanged,
}: {
  settings: SettingsView;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [minutes, setMinutes] = useState(settings.dailyMinutes);
  const [prop, setProp] = useState(settings.propagationEnabled);
  const [newKey, setNewKey] = useState("");
  const [keyMsg, setKeyMsg] = useState<string | null>(null);
  const [showItems, setShowItems] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ItemRow[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!showItems) return;
    const t = setTimeout(async () => {
      const r = await get<{ items: ItemRow[] }>(`/api/items?q=${encodeURIComponent(query)}`);
      setItems(r.items);
    }, 200);
    return () => clearTimeout(t);
  }, [showItems, query]);

  const saveSettings = async (m: number, p: boolean) => {
    await post("/api/settings", { dailyMinutes: m, propagationEnabled: p });
    onChanged();
  };

  const saveKey = async () => {
    setKeyMsg(null);
    try {
      await post("/api/settings/key", { key: newKey.trim() });
      setKeyMsg("Key updated.");
      setNewKey("");
      onChanged();
    } catch (e) {
      setKeyMsg(e instanceof Error ? e.message : "Failed.");
    }
  };

  const doImport = async (file: File) => {
    const text = await file.text();
    try {
      await post("/api/import", JSON.parse(text));
      onChanged();
      onClose();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Import failed.");
    }
  };

  const toggleArchive = async (it: ItemRow) => {
    await post(`/api/items/${it.id}/archive`, { archived: !it.archived });
    setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, archived: !x.archived } : x)));
  };

  const editItem = async (it: ItemRow, statement: string) => {
    await patch(`/api/items/${it.id}`, { statement });
    setItems((arr) => arr.map((x) => (x.id === it.id ? { ...x, statement } : x)));
  };

  return (
    <motion.div
      {...fade}
      className="fixed inset-0 z-10 overflow-y-auto bg-paper/95 backdrop-blur-sm dark:bg-paper-dark/95"
    >
      <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h2>
          <button
            onClick={onClose}
            aria-label="close"
            className="rounded-full p-2 text-ink/35 transition-colors hover:bg-ink/5 hover:text-ink/80 dark:text-ink-dark/35 dark:hover:bg-ink-dark/10 dark:hover:text-ink-dark/80"
          >
            <X size={18} />
          </button>
        </div>

        <section className="mt-10">
          <SectionLabel>Daily minutes</SectionLabel>
          <div className="mt-3 flex max-w-md items-center gap-4">
            <input
              type="range"
              min={3}
              max={45}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              onMouseUp={() => saveSettings(minutes, prop)}
              onTouchEnd={() => saveSettings(minutes, prop)}
              className="flex-1"
            />
            <span className="w-16 text-right tabular-nums">{minutes} min</span>
          </div>
        </section>

        <section className="mt-10">
          <SectionLabel>
            API key{" "}
            {settings.demoMode && <span className="normal-case tracking-normal text-amber-500">(currently: demo mode)</span>}
          </SectionLabel>
          <div className="mt-3 flex max-w-md flex-col gap-2 sm:flex-row">
            <input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && newKey.trim() && saveKey()}
              placeholder="sk-ant-… or 'demo'"
              className={`min-w-0 flex-1 ${fieldClass}`}
            />
            <PrimaryButton onClick={saveKey} disabled={!newKey.trim()} className="px-5 py-2.5 text-sm">
              Update
            </PrimaryButton>
          </div>
          {keyMsg && <p className="mt-2 text-sm text-ink/50 dark:text-ink-dark/50">{keyMsg}</p>}
        </section>

        <section className="mt-10">
          <SectionLabel>Propagation</SectionLabel>
          <label className="mt-3 flex max-w-md cursor-pointer items-center justify-between gap-4">
            <span className="text-sm leading-relaxed text-ink/60 dark:text-ink-dark/60">
              Experimental — when you pass an item, closely related items get a small memory boost.
            </span>
            <input
              type="checkbox"
              checked={prop}
              onChange={(e) => {
                setProp(e.target.checked);
                saveSettings(minutes, e.target.checked);
              }}
              className="h-5 w-5 shrink-0 accent-[#5c5fc4]"
            />
          </label>
        </section>

        <section className="mt-10">
          <SectionLabel>Your data</SectionLabel>
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <a
              href="/api/export"
              download
              className="flex items-center gap-1.5 text-sm text-accent underline-offset-4 hover:underline"
            >
              <Download size={14} /> Export everything (JSON)
            </a>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-1.5 text-sm text-ink/50 underline-offset-4 transition-colors hover:text-ink dark:text-ink-dark/50 dark:hover:text-ink-dark"
            >
              <Upload size={14} /> Import…
            </button>
          </div>
        </section>

        <section className="mt-12 border-t border-ink/10 pt-8 dark:border-ink-dark/10">
          <div className="flex items-center justify-between">
            <SectionLabel>Items</SectionLabel>
            <QuietButton onClick={() => setShowItems((v) => !v)}>
              {showItems ? "hide" : "browse (for corrections)"}
            </QuietButton>
          </div>
          {showItems && (
            <div className="mt-4">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className={`w-full ${fieldClass}`}
              />
              <ul className="mt-4 flex flex-col gap-2">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className={`flex items-start gap-3 rounded-xl border border-ink/10 bg-white/40 p-3 shadow-card transition-opacity dark:border-ink-dark/10 dark:bg-white/[0.03] ${it.archived ? "opacity-40" : ""}`}
                  >
                    <span className="flex shrink-0 flex-col items-start gap-1">
                      <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink/40 dark:bg-ink-dark/10 dark:text-ink-dark/40">
                        {it.kind}
                      </span>
                      {it.topic && (
                        <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                          {it.topic}
                        </span>
                      )}
                    </span>
                    {it.archived ? (
                      <span className="min-w-0 flex-1 text-sm leading-relaxed text-ink/60 dark:text-ink-dark/60">
                        <MathText text={it.statement} />
                      </span>
                    ) : (
                      <textarea
                        defaultValue={it.statement}
                        rows={Math.max(1, Math.ceil(it.statement.length / 70))}
                        onBlur={(e) => e.target.value !== it.statement && editItem(it, e.target.value)}
                        className="min-w-0 flex-1 resize-none bg-transparent text-sm leading-relaxed outline-none"
                      />
                    )}
                    <QuietButton onClick={() => toggleArchive(it)} className="shrink-0">
                      {it.archived ? "restore" : "archive"}
                    </QuietButton>
                  </li>
                ))}
                {items.length === 0 && (
                  <li className="text-sm text-ink/40 dark:text-ink-dark/40">No items match.</li>
                )}
              </ul>
            </div>
          )}
        </section>
      </div>
    </motion.div>
  );
}
