import { useState } from "react";
import { motion } from "framer-motion";
import { post } from "../api";
import { fade } from "../motion";
import { PrimaryButton, QuietButton } from "../components/widgets";

// First-run moment one: a single centered panel. Name, one sentence, key
// field, Connect. This screen is part of the product — keep it calm.

export function KeyScreen({ onConnected }: { onConnected: (demo: boolean) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ ok: boolean; demoMode: boolean }>("/api/settings/key", { key: value });
      onConnected(r.demoMode);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
      setBusy(false);
    }
  };

  return (
    <motion.div {...fade} className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } }}
          className="font-display text-5xl italic tracking-tight"
        >
          Tract
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut", delay: 0.08 } }}
          className="mt-5 font-display text-xl leading-relaxed text-ink/60 dark:text-ink-dark/60"
        >
          A memory partner. Feed it what you're learning; press Start every day.
        </motion.p>
        <form
          className="mt-10 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) connect(key.trim());
          }}
        >
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Anthropic API key (sk-ant-…)"
            autoFocus
            className="w-full rounded-xl border border-ink/15 bg-white/40 px-4 py-3 text-center shadow-card outline-none transition-colors focus:border-accent dark:border-ink-dark/20 dark:bg-white/[0.03]"
          />
          <PrimaryButton disabled={busy || !key.trim()} className="w-full">
            {busy ? "Checking…" : "Connect"}
          </PrimaryButton>
        </form>
        {error && (
          <motion.p {...fade} className="mt-4 text-sm text-red-500">
            {error}
          </motion.p>
        )}
        <div className="mt-8">
          <QuietButton onClick={() => connect("demo")}>
            No key? Try demo mode — a mocked AI, clearly less smart.
          </QuietButton>
        </div>
      </div>
    </motion.div>
  );
}
