import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ImagePlus, X } from "lucide-react";
import { get, post, type DraftItem, type ExtractView, type GoalView, type Kind } from "../api";
import { fade, staggerOption } from "../motion";
import { PrimaryButton, QuietButton, PulsePlaceholder } from "../components/widgets";

const KINDS: Kind[] = ["fact", "concept", "distinction", "procedure"];

interface AttachedImage {
  data: string;
  mediaType: string;
  name: string;
}

const NEW_TOPIC = "__new__";
const NO_TOPIC = "__none__";

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
  const [goals, setGoals] = useState<GoalView[]>([]);
  const [goalChoice, setGoalChoice] = useState<string>(firstRun ? NEW_TOPIC : NO_TOPIC);
  const [goalName, setGoalName] = useState("");
  const [goalDate, setGoalDate] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [extract, setExtract] = useState<ExtractView | null>(null);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [removed, setRemoved] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    get<{ goals: GoalView[] }>("/api/goals")
      .then((r) => {
        setGoals(r.goals);
        if (!firstRun && r.goals.length > 0) setGoalChoice(r.goals[0].id);
      })
      .catch(() => {});
  }, [firstRun]);

  const addImageFile = (file: File) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      const [, mediaType, data] = url.match(/^data:(.+?);base64,(.*)$/) ?? [];
      if (data) setImages((arr) => [...arr.slice(0, 7), { data, mediaType, name: file.name || "pasted image" }]);
    };
    reader.readAsDataURL(file);
  };

  // Paste an image anywhere on the screen (screenshots straight from the clipboard).
  useEffect(() => {
    if (phase !== "input") return;
    const h = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? [])
        .filter((it) => it.type.startsWith("image/"))
        .map((it) => it.getAsFile())
        .filter((f): f is File => f !== null);
      if (files.length > 0) {
        e.preventDefault();
        files.forEach(addImageFile);
      }
    };
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  }, [phase]);

  const runExtract = async () => {
    setPhase("extracting");
    setError(null);
    try {
      const r = await post<ExtractView>("/api/ingest/extract", {
        text,
        images: images.map(({ data, mediaType }) => ({ data, mediaType })),
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
    const goal =
      goalChoice === NO_TOPIC
        ? null
        : goalChoice === NEW_TOPIC
          ? goalName.trim()
            ? { name: goalName.trim(), targetDate: goalDate || null }
            : null
          : { id: goalChoice };
    try {
      await post("/api/ingest/commit", { items: kept, edges, sourceText: text, goal });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
      <AnimatePresence mode="wait">
        {phase === "input" && (
          <motion.div key="input" {...fade}>
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              {firstRun ? "Feed it something." : "Add material"}
            </h2>
            <p className="mt-2 text-ink/60 dark:text-ink-dark/60">
              Paste your notes, a syllabus, a textbook page — text or screenshots, anything.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              rows={12}
              className="mt-6 w-full resize-y rounded-2xl border border-ink/15 bg-white/40 p-4 leading-relaxed shadow-card outline-none transition-colors focus:border-accent dark:border-ink-dark/20 dark:bg-white/[0.03]"
              placeholder="Paste here — text, or an image straight from your clipboard…"
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  Array.from(e.target.files ?? []).forEach(addImageFile);
                  e.target.value = "";
                }}
              />
              <AnimatePresence>
                {images.map((img, i) => (
                  <motion.span
                    key={`${img.name}-${i}`}
                    {...fade}
                    layout
                    className="flex items-center gap-1.5 rounded-full border border-ink/10 bg-white/50 py-1 pl-2 pr-1 text-xs text-ink/60 shadow-card dark:border-ink-dark/15 dark:bg-white/[0.04] dark:text-ink-dark/60"
                  >
                    <img
                      src={`data:${img.mediaType};base64,${img.data}`}
                      alt=""
                      className="h-6 w-6 rounded-full object-cover"
                    />
                    {img.name.length > 24 ? img.name.slice(0, 22) + "…" : img.name}
                    <button
                      onClick={() => setImages((arr) => arr.filter((_, j) => j !== i))}
                      aria-label={`remove ${img.name}`}
                      className="rounded-full p-0.5 hover:bg-ink/10 dark:hover:bg-ink-dark/15"
                    >
                      <X size={11} />
                    </button>
                  </motion.span>
                ))}
              </AnimatePresence>
              <button
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 text-sm text-ink/50 transition-colors hover:text-ink dark:text-ink-dark/50 dark:hover:text-ink-dark"
              >
                <ImagePlus size={15} /> add images <span className="text-ink/30 dark:text-ink-dark/30">(or just paste)</span>
              </button>
            </div>

            <div className="mt-8 border-t border-ink/10 pt-6 dark:border-ink-dark/10">
              <p className="text-sm text-ink/60 dark:text-ink-dark/60">What's this for, and when? (optional)</p>
              <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                <select
                  value={goalChoice}
                  onChange={(e) => setGoalChoice(e.target.value)}
                  className="rounded-xl border border-ink/15 bg-white/40 px-3 py-2.5 outline-none focus:border-accent dark:border-ink-dark/20 dark:bg-paper-dark"
                >
                  <option value={NO_TOPIC}>No topic</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                  <option value={NEW_TOPIC}>New topic…</option>
                </select>
                {goalChoice === NEW_TOPIC && (
                  <>
                    <input
                      value={goalName}
                      onChange={(e) => setGoalName(e.target.value)}
                      placeholder="e.g. Chemistry final"
                      className="flex-1 rounded-xl border border-ink/15 bg-white/40 px-4 py-2.5 outline-none focus:border-accent dark:border-ink-dark/20 dark:bg-white/[0.03]"
                    />
                    <input
                      type="date"
                      value={goalDate}
                      onChange={(e) => setGoalDate(e.target.value)}
                      className="rounded-xl border border-ink/15 bg-white/40 px-4 py-2.5 outline-none focus:border-accent dark:border-ink-dark/20 dark:bg-white/[0.03]"
                    />
                  </>
                )}
              </div>
            </div>

            {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
            <div className="mt-8 flex items-center gap-4">
              <PrimaryButton onClick={runExtract} disabled={!text.trim() && images.length === 0}>
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
            <h2 className="font-display text-3xl font-semibold tracking-tight">
              {drafts.length - removed.size} item{drafts.length - removed.size === 1 ? "" : "s"} extracted
            </h2>
            <p className="mt-2 text-ink/60 dark:text-ink-dark/60">
              Edit anything that reads wrong. Everything here is accepted by default.
              {extract.richer && " The material was richer than this — re-ingest more later if you want it all."}
              {extract.skippedDuplicates > 0 &&
                ` ${extract.skippedDuplicates} duplicate(s) of items you already have were skipped.`}
            </p>
            <ul className="mt-6 grid grid-cols-2 gap-3">
              {drafts.map((d, i) =>
                removed.has(i) ? null : (
                  <motion.li
                    key={i}
                    {...staggerOption(Math.min(i, 12))}
                    className={`group flex flex-col gap-2 rounded-xl border border-ink/10 bg-white/40 p-4 shadow-card dark:border-ink-dark/10 dark:bg-white/[0.03] ${
                      d.statement.length > 120 ? "col-span-2" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex shrink-0 flex-col gap-1">
                        <select
                          value={d.kind}
                          onChange={(e) =>
                            setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, kind: e.target.value as Kind } : x)))
                          }
                          className="w-24 rounded-md border-0 bg-ink/5 px-1.5 py-1 text-xs text-ink/60 outline-none dark:bg-ink-dark/10 dark:text-ink-dark/60"
                        >
                          {KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        <input
                          value={d.topic ?? ""}
                          placeholder="topic"
                          onChange={(e) =>
                            setDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, topic: e.target.value } : x)))
                          }
                          className="w-24 rounded-md bg-accent/10 px-1.5 py-1 text-xs text-accent outline-none placeholder:text-accent/40"
                        />
                      </span>
                      <button
                        onClick={() => setRemoved((r) => new Set(r).add(i))}
                        className="text-ink/30 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100 dark:text-ink-dark/30"
                        aria-label="remove item"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <textarea
                      value={d.statement}
                      rows={Math.max(2, Math.ceil(d.statement.length / 55))}
                      onChange={(e) =>
                        setDrafts((ds) =>
                          ds.map((x, j) => (j === i ? { ...x, statement: e.target.value, distractors: [] } : x))
                        )
                      }
                      className="w-full resize-none bg-transparent text-sm leading-relaxed outline-none"
                    />
                  </motion.li>
                )
              )}
            </ul>
            {error && <p className="mt-4 text-sm text-red-500">{error}</p>}
            <div className="mt-8 flex items-center gap-4">
              <PrimaryButton onClick={commit} busy={busy} disabled={drafts.length - removed.size === 0}>
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
