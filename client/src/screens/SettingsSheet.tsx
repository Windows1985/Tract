import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { get, patch, post, type SettingsView } from "../api";
import { fade } from "../motion";
import { PrimaryButton, QuietButton } from "../components/widgets";

interface ItemRow {
  id: string;
  statement: string;
  kind: string;
  archived: boolean;
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
    <AnimatePresence>
      <motion.div
        {...fade}
        className="fixed inset-0 z-10 overflow-y-auto bg-paper/95 backdrop-blur-sm dark:bg-paper-dark/95"
      >
        <div className="mx-auto w-full max-w-2xl px-6 py-16">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-3xl font-semibold tracking-tight">Settings</h2>
            <QuietButton onClick={onClose}>close</QuietButton>
          </div>

          <section className="mt-10">
            <label className="text-sm text-ink/50 dark:text-ink-dark/50">Daily minutes</label>
            <div className="mt-2 flex items-center gap-4">
              <input
                type="range"
                min={3}
                max={45}
                value={minutes}
                onChange={(e) => {
                  setMinutes(Number(e.target.value));
                }}
                onMouseUp={() => saveSettings(minutes, prop)}
                onTouchEnd={() => saveSettings(minutes, prop)}
                className="max-w-xs"
              />
              <span className="tabular-nums">{minutes} min</span>
            </div>
          </section>

          <section className="mt-10">
            <label className="text-sm text-ink/50 dark:text-ink-dark/50">
              API key {settings.demoMode && <span className="text-amber-500">(currently: demo mode)</span>}
            </label>
            <div className="mt-2 flex max-w-md gap-2">
              <input
                type="password"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="sk-ant-… or 'demo'"
                className="flex-1 rounded-xl border border-ink/15 bg-transparent px-4 py-2 outline-none focus:border-accent dark:border-ink-dark/20"
              />
              <PrimaryButton onClick={saveKey} disabled={!newKey.trim()} className="px-5 py-2 text-sm">
                Update
              </PrimaryButton>
            </div>
            {keyMsg && <p className="mt-2 text-sm text-ink/50 dark:text-ink-dark/50">{keyMsg}</p>}
          </section>

          <section className="mt-10">
            <label className="flex max-w-md cursor-pointer items-center justify-between">
              <span>
                Propagation{" "}
                <span className="text-sm text-ink/40 dark:text-ink-dark/40">(experimental — related items get a small boost on pass)</span>
              </span>
              <input
                type="checkbox"
                checked={prop}
                onChange={(e) => {
                  setProp(e.target.checked);
                  saveSettings(minutes, e.target.checked);
                }}
                className="h-5 w-5 accent-[#5c5fc4]"
              />
            </label>
          </section>

          <section className="mt-10 flex items-center gap-6">
            <a href="/api/export" download className="text-sm text-accent underline-offset-4 hover:underline">
              Export everything (JSON)
            </a>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
            />
            <QuietButton onClick={() => fileRef.current?.click()}>Import…</QuietButton>
          </section>

          <section className="mt-12 border-t border-ink/10 pt-8 dark:border-ink-dark/10">
            <QuietButton onClick={() => setShowItems((v) => !v)}>
              {showItems ? "hide items" : "browse items (for corrections)"}
            </QuietButton>
            {showItems && (
              <div className="mt-4">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search…"
                  className="w-full max-w-md rounded-xl border border-ink/15 bg-transparent px-4 py-2 outline-none focus:border-accent dark:border-ink-dark/20"
                />
                <ul className="mt-4 flex flex-col gap-2">
                  {items.map((it) => (
                    <li
                      key={it.id}
                      className={`flex items-start gap-3 rounded-xl border border-ink/10 p-3 dark:border-ink-dark/10 ${it.archived ? "opacity-40" : ""}`}
                    >
                      <span className="mt-0.5 shrink-0 rounded bg-ink/5 px-1.5 py-0.5 text-xs text-ink/50 dark:bg-ink-dark/10 dark:text-ink-dark/50">
                        {it.kind}
                      </span>
                      <textarea
                        defaultValue={it.statement}
                        rows={Math.max(1, Math.ceil(it.statement.length / 70))}
                        onBlur={(e) => e.target.value !== it.statement && editItem(it, e.target.value)}
                        className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
                      />
                      <QuietButton onClick={() => toggleArchive(it)}>
                        {it.archived ? "restore" : "archive"}
                      </QuietButton>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
