import { useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { post, type DraftItem, type ExtractView, type Kind } from "../api";
import { fade } from "../motion";
import { PrimaryButton, QuietButton, PulsePlaceholder } from "../components/widgets";

const KINDS: Kind[] = ["fact", "concept", "distinction", "procedure"];

export function IngestScreen({
  firstRun,
  onDone,
  onCancel,
}: {
  firstRun: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [phase, setPhase] = useState<"input" | "extracting" | "review">("input");
  const [text, setText] = useState("");
  const [goalName, setGoalName] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [image, setImage] = useState<{ data: string; mediaType: string; name: string } | null>(null);
  const [extract, setExtract] = useState<ExtractView | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const pickImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const [, mediaType, data] = url.match(/^data:(.+?);base64,(.*)$/) ?? [];
      if (data) setImage({ data, mediaType, name: file.name });
    };
    reader.readAsDataURL(file);
  };

  const runExtract = async () => {
    setPhase("extracting");
    setError(null);
    try {
      const r = await post<ExtractView>("/api/ingest/extract", {
        text,
        image: image ? { data: image.data, mediaType: image.mediaType } : null,
      });
      setExtract(r);
      setDrafts(r.items);
      setRemoved(new Set());
      setPhase("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed.");
      setPhase("input");
    }
  };

  const commit = async () => {
    setBusy(true);
    setError(null);
    const kept: DraftItem[] = [];
    const indexMap = new Map<number, number>();
    drafts.forEach((d, i) => {
      if (!removed.has(i)) {
        indexMap.set(i, kept.length);
        kept.push(d);
      }
    });
    const edges = (extract?.edges ?? [])
      .filter((e) => indexMap.has(e.a) && indexMap.has(e.b))
      .map((e) => ({ ...e, a: indexMap.get(e.a)!, b: indexMap.get(e.b)! }));
    try {
      await post("/api/ingest/commit", {
        items: kept,
        edges,
        sourceText: text,
        goal: goalName.trim() ? { name: goalName.trim(), targetDate: goalDate || null } : null,
      });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-6 py-16">
      <AnimatePresence mode="wait">
        {phase === "input" && (
          <motion.div key="input" {...fade}>
            <h2 className="font-display text-3xl tracking-tight">
              {firstRun ? "Feed it something." : "Add material"}
            </h2>
            <p className="mt-2 text-ink/60 dark:text-ink-dark/60">
              Paste your notes, a syllabus, a textbook page — anything.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              rows={12}
              className="mt-6 w-full resize-y rounded-xl border border-ink/15 bg-transparent p-4 leading-relaxed outline-none transition-colors focus:border-accent dark:border-ink-dark/20"
              placeholder="Paste here…"
            />
            <div className="mt-3 flex items-center gap-4">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && pickImage(e.target.files[0])}
              />
              <QuietButton onClick={() => fileRef.current?.click()}>
                {image ? `Image: ${image.name} ✕` : "+ attach an image"}
              </QuietButton>
              {image && <QuietButton onClick={() => setImage(null)}>remove</QuietButton>}
            </div>

            <div className="mt-8 border-t border-ink/10 pt-6 dark:border-ink-dark/10">
              <p className="text-sm text-ink/60 dark:text-ink-dark/60">What's this for, and when? (optional)</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <input
                  value={goalName}
                  onChange={(e) => setGoalName(e.target.value)}
                  placeholder="e.g. Chemistry final"
                  className="flex-1 rounded-xl border border-ink/15 bg-transparent px-4 py-2.5 outline-none focus:border-accent dark:border-ink-dark/20"
                />
                <input
                  type="date"
                  value={goalDate}
                  onChange={(e) => setGoalDate(e.target.value)}
                  className="rounded-xl border border-ink/15 bg-transparent px-4 py-2.5 outline-none focus:border-accent dark:border-ink-dark/20"
                />
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
            <div className="mt-8 flex items-center gap-4">
              <PrimaryButton onClick={runExtract} disabled={!text.trim() && !image}>
                Extract
              </PrimaryButton>
              {onCancel && <QuietButton onClick={onCancel}>cancel</QuietButton>}
            </div>
          </motion.div>
        )}

        {phase === "extracting" && (
          <motion.div key="extracting" {...fade} className="pt-24">
            <PulsePlaceholder label="reading your material, finding what's worth remembering" />
          </motion.div>
        )}

        {phase === "review" && extract && (
          <motion.div key="review" {...fade}>
            <h2 className="font-display text-3xl tracking-tight">
              {drafts.length - removed.size} item{drafts.length - removed.size === 1 ? "" : "s"} extracted
            </h2>
            <p className="mt-2 text-ink/60 dark:text-ink-dark/60">
              Edit anything that reads wrong. Everything here is accepted by default.
              {extract.richer && " The material was richer than this — re-ingest more later if you want it all."}
              {extract.skippedDuplicates > 0 && ` ${extract.skippedDuplicates} duplicate(s) of items you already have were skipped.`}
            </p>
            <ul className="mt-6 flex flex-col gap-2">
              {drafts.map((d, i) =>
                removed.has(i) ? null : (
                  <motion.li
                    key={i}
                    {...fade}
                    className="group flex items-start gap-3 rounded-xl border border-ink/10 p-3 dark:border-ink-dark/10"
                  >
                    <select
                      value={d.kind}
                      onChange={(e) =>
                        setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, kind: e.target.value as Kind } : x)))
                      }
                      className="mt-0.5 shrink-0 rounded-md border-0 bg-ink/5 px-1.5 py-1 text-xs text-ink/60 outline-none dark:bg-ink-dark/10 dark:text-ink-dark/60"
                    >
                      {KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={d.statement}
                      rows={Math.max(1, Math.ceil(d.statement.length / 70))}
                      onChange={(e) =>
                        setDrafts((ds) =>
                          ds.map((x, j) => (j === i ? { ...x, statement: e.target.value, distractors: [] } : x))
                        )
                      }
                      className="w-full resize-none bg-transparent leading-relaxed outline-none"
                    />
                    <button
                      onClick={() => setRemoved((r) => new Set(r).add(i))}
                      className="text-ink/30 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 dark:text-ink-dark/30"
                      aria-label="remove item"
                    >
                      ✕
                    </button>
                  </motion.li>
                )
              )}
            </ul>
            {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
            <div className="mt-8 flex items-center gap-4">
              <PrimaryButton onClick={commit} disabled={busy || drafts.length - removed.size === 0}>
                {busy ? "Saving…" : "Looks right"}
              </PrimaryButton>
              <QuietButton onClick={() => setPhase("input")}>back</QuietButton>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
