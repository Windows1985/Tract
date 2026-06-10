import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X } from "lucide-react";
import {
  get,
  post,
  type AnswerResult,
  type FinishView,
  type Outcome,
  type ProbeView,
  type SessionStart,
  type SweepResult,
} from "../api";
import { crossfade, fade, reveal, staggerOption } from "../motion";
import { MathText } from "../components/Katex";
import {
  CountUp,
  PrimaryButton,
  PulsePlaceholder,
  QuietButton,
  Spinner,
  Thinking,
  TimerRing,
} from "../components/widgets";

type Phase = "starting" | "sweep" | "sweepResult" | "probe" | "calibration" | "end" | "empty";

const SWEEP_SECONDS = 90;
const ACTIVE_SESSION_KEY = "tract.activeSession";

export function SessionScreen({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<Phase>("starting");
  const [session, setSession] = useState<SessionStart | null>(null);
  const [sweepResult, setSweepResult] = useState<SweepResult | null>(null);
  const [index, setIndex] = useState(0);
  const [probe, setProbe] = useState<ProbeView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calibrated, setCalibrated] = useState(false);
  const [finish, setFinish] = useState<FinishView | null>(null);

  useEffect(() => {
    (async () => {
      try {
        // Resume a session left mid-way: the answered prefix is already in
        // the evidence log, so we pick up exactly where the learner exited.
        const savedId = localStorage.getItem(ACTIVE_SESSION_KEY);
        if (savedId) {
          try {
            const st = await get<SessionStart & { sweepDone: boolean; nextIndex: number }>(
              `/api/session/${savedId}/state`
            );
            if (st.nextIndex < st.queueLength || (st.sweep && !st.sweepDone)) {
              setSession(st);
              setIndex(st.nextIndex);
              setPhase(st.sweep && !st.sweepDone ? "sweep" : "probe");
              return;
            }
          } catch {
            localStorage.removeItem(ACTIVE_SESSION_KEY); // session expired — start fresh
          }
        }
        const s = await post<SessionStart>("/api/session/start");
        setSession(s);
        localStorage.setItem(ACTIVE_SESSION_KEY, s.sessionId);
        if (s.sweep) setPhase("sweep");
        else if (s.queueLength === 0) {
          localStorage.removeItem(ACTIVE_SESSION_KEY);
          setPhase("empty");
        } else setPhase("probe");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not start.");
      }
    })();
  }, []);

  const loadProbe = useCallback(
    async (i: number) => {
      if (!session) return;
      setProbe(null);
      try {
        const p = await get<ProbeView>(`/api/session/${session.sessionId}/probe/${i}`);
        if ((p as any).done) {
          localStorage.removeItem(ACTIVE_SESSION_KEY); // queue exhausted — nothing left to resume
          setPhase(calibrated ? "end" : "calibration");
          if (calibrated) {
            const f = await post<FinishView>(`/api/session/${session.sessionId}/finish`);
            setFinish(f);
          }
          return;
        }
        setProbe(p);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Probe failed.");
      }
    },
    [session, calibrated]
  );

  useEffect(() => {
    if (phase === "probe" && session) loadProbe(index);
  }, [phase, index, session, loadProbe]);

  const advance = () => setIndex((i) => i + 1);

  const onCalibrationDone = async () => {
    if (!session) return;
    setCalibrated(true);
    const f = await post<FinishView>(`/api/session/${session.sessionId}/finish`);
    setFinish(f);
    setPhase("end");
  };

  const extend = async () => {
    if (!session) return;
    const r = await post<{ added: number }>(`/api/session/${session.sessionId}/extend`);
    if (r.added > 0) {
      localStorage.setItem(ACTIVE_SESSION_KEY, session.sessionId);
      setPhase("probe");
    }
  };

  // Esc ends the session from the probe flow — everything answered so far
  // is already in the evidence log, so leaving early loses nothing.
  useEffect(() => {
    if (phase !== "probe" && phase !== "sweepResult") return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [phase, onExit]);

  if (error)
    return (
      <CenterPanel>
        <p className="text-lg">{error}</p>
        <PrimaryButton className="mt-6" onClick={onExit}>
          Back
        </PrimaryButton>
      </CenterPanel>
    );

  const showChrome = phase === "sweep" || phase === "sweepResult" || phase === "probe";
  const progress =
    phase === "probe" && probe ? probe.index / Math.max(1, probe.total) : phase === "sweep" ? 0 : 1;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6">
      {showChrome && (
        <div className="sticky top-0 z-10 -mx-6 flex items-center gap-4 bg-paper/80 px-6 pb-3 pt-5 backdrop-blur-sm dark:bg-paper-dark/80">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-ink/10 dark:bg-ink-dark/15">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-accent-soft to-accent"
              animate={{ width: `${Math.round(progress * 100)}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
          <button
            onClick={onExit}
            title="End session — progress is saved"
            aria-label="End session"
            className="rounded-full p-1.5 text-ink/35 transition-colors hover:bg-ink/5 hover:text-ink/80 dark:text-ink-dark/35 dark:hover:bg-ink-dark/10 dark:hover:text-ink-dark/80"
          >
            <X size={18} />
          </button>
        </div>
      )}

      <AnimatePresence mode="wait">
        {phase === "starting" && (
          <motion.div key="starting" {...fade} className="flex flex-1 items-center justify-center">
            <PulsePlaceholder label="composing today's session" />
          </motion.div>
        )}

        {phase === "empty" && (
          <CenterPanel key="empty">
            <p className="font-display text-2xl">Nothing is due right now.</p>
            <p className="mt-2 text-ink/50 dark:text-ink-dark/50">Come back tomorrow — or add material.</p>
            <PrimaryButton className="mt-8" onClick={onExit}>
              Done
            </PrimaryButton>
          </CenterPanel>
        )}

        {phase === "sweep" && session?.sweep && (
          <SweepView
            key="sweep"
            sessionId={session.sessionId}
            goalName={session.sweep.goalName}
            onDone={(r) => {
              setSweepResult(r);
              setPhase("sweepResult");
            }}
          />
        )}

        {phase === "sweepResult" && sweepResult && (
          <CenterPanel key="sweepResult">
            <p className="font-display text-3xl leading-relaxed">
              You covered {sweepResult.covered} of {sweepResult.total}.
            </p>
            {sweepResult.slipped.length > 0 && (
              <div className="mt-6 text-left">
                <p className="text-xs uppercase tracking-[0.2em] text-ink/40 dark:text-ink-dark/40">These slipped</p>
                <ul className="mt-3 flex flex-col gap-2 text-ink/70 dark:text-ink-dark/70">
                  {sweepResult.slipped.slice(0, 6).map((s, i) => (
                    <motion.li key={i} {...staggerOption(i)} className="leading-snug">
                      · <MathText text={s} />
                    </motion.li>
                  ))}
                  {sweepResult.slipped.length > 6 && <li>· …and {sweepResult.slipped.length - 6} more</li>}
                </ul>
              </div>
            )}
            <PrimaryButton className="mt-8" onClick={() => setPhase("probe")}>
              Continue
            </PrimaryButton>
          </CenterPanel>
        )}

        {phase === "probe" && (
          <ProbeRunner
            key={`probe-${index}`}
            sessionId={session!.sessionId}
            probe={probe}
            onAdvance={advance}
          />
        )}

        {phase === "calibration" && session && (
          <CalibrationView key="calibration" sessionId={session.sessionId} onDone={onCalibrationDone} />
        )}

        {phase === "end" && finish && <EndView key="end" finish={finish} onExit={onExit} onExtend={extend} />}
      </AnimatePresence>
    </div>
  );
}

function CenterPanel({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...fade} className="flex flex-1 flex-col items-center justify-center py-16 text-center">
      {children}
    </motion.div>
  );
}

// --- sweep -------------------------------------------------------------------

function SweepView({
  sessionId,
  goalName,
  onDone,
}: {
  sessionId: string;
  goalName: string;
  onDone: (r: SweepResult) => void;
}) {
  const [dump, setDump] = useState("");
  const [seconds, setSeconds] = useState(SWEEP_SECONDS);
  const [busy, setBusy] = useState(false);
  const started = useRef(Date.now());
  const submitted = useRef(false);
  const dumpRef = useRef("");
  dumpRef.current = dump;

  const submit = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    const r = await post<SweepResult>(`/api/session/${sessionId}/sweep`, {
      dump: dumpRef.current,
      durationMs: Date.now() - started.current,
    });
    onDone(r);
  }, [sessionId, onDone]);

  useEffect(() => {
    const t = setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) {
          clearInterval(t);
          submit();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [submit]);

  return (
    <motion.div {...fade} className="flex flex-1 flex-col justify-center py-12">
      <div className="flex items-center justify-between">
        <p className="font-display text-[28px] leading-snug">
          Write everything you know about <span className="font-semibold text-accent">{goalName}</span>.
        </p>
        <div className="relative ml-6 shrink-0">
          <TimerRing seconds={seconds} total={SWEEP_SECONDS} />
          <span className="absolute inset-0 flex items-center justify-center text-sm tabular-nums text-ink/60 dark:text-ink-dark/60">
            {seconds}
          </span>
        </div>
      </div>
      <textarea
        value={dump}
        onChange={(e) => setDump(e.target.value)}
        autoFocus
        rows={10}
        disabled={busy}
        placeholder="Everything. Fragments are fine."
        className="mt-8 w-full resize-none rounded-2xl border border-ink/15 bg-white/40 p-5 text-lg leading-relaxed shadow-card outline-none transition-colors focus:border-accent disabled:opacity-60 dark:border-ink-dark/20 dark:bg-white/[0.03]"
      />
      <div className="mt-6 flex items-center gap-5">
        <PrimaryButton onClick={submit} busy={busy}>
          {busy ? "Reading…" : "Done"}
        </PrimaryButton>
        {busy && <Thinking label="comparing against what you should know" />}
      </div>
    </motion.div>
  );
}

// --- probes ------------------------------------------------------------------

function ProbeRunner({
  sessionId,
  probe,
  onAdvance,
}: {
  sessionId: string;
  probe: ProbeView | null;
  onAdvance: () => void;
}) {
  if (!probe)
    return (
      <motion.div {...fade} className="flex flex-1 items-center justify-center">
        <PulsePlaceholder />
      </motion.div>
    );
  return (
    <motion.div {...fade} className="flex flex-1 flex-col justify-center py-12">
      <p className="mb-6 text-xs uppercase tracking-[0.25em] text-ink/35 dark:text-ink-dark/35">
        {probe.index + 1} / {probe.total}
        {probe.isRetry && <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-accent">again</span>}
      </p>
      {probe.modality === "mcq" && <McqProbe key={probe.index} sessionId={sessionId} probe={probe} onAdvance={onAdvance} />}
      {probe.modality === "cued" && <CuedProbe key={probe.index} sessionId={sessionId} probe={probe} onAdvance={onAdvance} />}
      {(probe.modality === "typed" || probe.modality === "explain") && (
        <TypedProbe key={probe.index} sessionId={sessionId} probe={probe} onAdvance={onAdvance} />
      )}
    </motion.div>
  );
}

function QuestionText({ text }: { text: string }) {
  return (
    <p className="font-display text-[28px] leading-snug">
      <MathText text={text} />
    </p>
  );
}

function Corrective({ text, onAck }: { text: string; onAck: () => void }) {
  useKey("Enter", onAck);
  return (
    <motion.div {...reveal} className="mt-8 rounded-2xl border border-accent/30 bg-accent/5 p-5 shadow-card">
      <p className="leading-relaxed">
        <MathText text={text} />
      </p>
      <PrimaryButton className="mt-4" onClick={onAck}>
        Got it
      </PrimaryButton>
    </motion.div>
  );
}

function useKey(key: string, fn: (() => void) | null) {
  useEffect(() => {
    if (!fn) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === key && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [key, fn]);
}

function McqProbe({ sessionId, probe, onAdvance }: { sessionId: string; probe: ProbeView; onAdvance: () => void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const started = useRef(Date.now());
  const options = probe.options ?? [];

  const pick = async (i: number) => {
    if (picked !== null) return;
    setPicked(i); // instant feedback — the row shows a spinner while we wait
    const r = await post<AnswerResult>(`/api/session/${sessionId}/answer`, {
      index: probe.index,
      durationMs: Date.now() - started.current,
      optionIndex: i,
    });
    setResult(r);
    if (r.outcome === "pass") setTimeout(onAdvance, 650);
  };

  // Keyboard 1–4 picks an option.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= options.length && picked === null) pick(n - 1);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, options.length]);

  const waiting = picked !== null && result === null;

  return (
    <div>
      <QuestionText text={probe.question} />
      <div className="mt-8 flex flex-col gap-3">
        {options.map((opt, i) => {
          const isCorrect = result && i === result.correctIndex;
          const isWrongPick = result && picked === i && i !== result.correctIndex;
          const isPending = waiting && picked === i;
          return (
            <motion.button
              key={i}
              {...staggerOption(i)}
              onClick={() => pick(i)}
              disabled={picked !== null}
              className={`group flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left leading-snug shadow-card transition-all ${
                isCorrect
                  ? "border-accent bg-accent/10"
                  : isWrongPick
                    ? "border-red-400/60 bg-red-400/5"
                    : isPending
                      ? "border-accent/60 bg-accent/5"
                      : picked !== null
                        ? "border-ink/10 opacity-50 dark:border-ink-dark/15"
                        : "border-ink/15 hover:-translate-y-px hover:border-accent/60 dark:border-ink-dark/20"
              }`}
            >
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-medium transition-colors ${
                  isCorrect
                    ? "bg-accent text-white"
                    : "bg-ink/5 text-ink/45 group-hover:bg-accent/15 group-hover:text-accent dark:bg-ink-dark/10 dark:text-ink-dark/45"
                }`}
              >
                {isPending ? <Spinner className="h-3 w-3" /> : isCorrect ? <Check size={12} /> : i + 1}
              </span>
              <MathText text={opt} />
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence>
        {waiting && (
          <motion.div {...fade} className="mt-6">
            <Thinking label="checking" />
          </motion.div>
        )}
      </AnimatePresence>
      {result?.corrective && <Corrective text={result.corrective} onAck={onAdvance} />}
    </div>
  );
}

function CuedProbe({ sessionId, probe, onAdvance }: { sessionId: string; probe: ProbeView; onAdvance: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const started = useRef(Date.now());

  const rate = async (selfRating: Outcome) => {
    if (result || busy) return;
    setBusy(true);
    const r = await post<AnswerResult>(`/api/session/${sessionId}/answer`, {
      index: probe.index,
      durationMs: Date.now() - started.current,
      selfRating,
    });
    setResult(r);
    setBusy(false);
    if (selfRating !== "fail") onAdvance();
  };

  useKey("Enter", !revealed ? () => setRevealed(true) : null);
  useKey("1", revealed && !result && !busy ? () => rate("pass") : null);
  useKey("2", revealed && !result && !busy ? () => rate("partial") : null);
  useKey("3", revealed && !result && !busy ? () => rate("fail") : null);

  return (
    <div>
      <QuestionText text={probe.question} />
      {!revealed ? (
        <div className="mt-10">
          <p className="text-sm text-ink/40 dark:text-ink-dark/40">Think it through, then reveal.</p>
          <PrimaryButton className="mt-3" onClick={() => setRevealed(true)}>
            Reveal
          </PrimaryButton>
        </div>
      ) : (
        <motion.div {...reveal} className="mt-10">
          <p className="rounded-2xl border border-ink/10 bg-white/40 p-5 text-lg leading-relaxed shadow-card dark:border-ink-dark/15 dark:bg-white/[0.03]">
            <MathText text={probe.canonical ?? ""} />
          </p>
          {!result && !busy && (
            <div className="mt-6 flex gap-3">
              {(
                [
                  ["pass", "Knew it", "1"],
                  ["partial", "Partly", "2"],
                  ["fail", "Didn't", "3"],
                ] as const
              ).map(([rating, label, k]) => (
                <motion.button
                  key={rating}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => rate(rating)}
                  className="flex-1 rounded-xl border border-ink/15 px-4 py-3 shadow-card transition-colors hover:border-accent dark:border-ink-dark/20"
                >
                  {label} <span className="ml-1 text-xs text-ink/30 dark:text-ink-dark/30">{k}</span>
                </motion.button>
              ))}
            </div>
          )}
          {busy && (
            <div className="mt-6">
              <Thinking label="writing a corrective" />
            </div>
          )}
        </motion.div>
      )}
      {result?.corrective && <Corrective text={result.corrective} onAck={onAdvance} />}
    </div>
  );
}

function TypedProbe({ sessionId, probe, onAdvance }: { sessionId: string; probe: ProbeView; onAdvance: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const started = useRef(Date.now());

  const submit = async () => {
    if (busy || result) return;
    setBusy(true);
    const r = await post<AnswerResult>(`/api/session/${sessionId}/answer`, {
      index: probe.index,
      durationMs: Date.now() - started.current,
      text,
    });
    setResult(r);
    setBusy(false);
  };

  return (
    <div>
      <QuestionText text={probe.question} />
      {!result ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            autoFocus
            rows={4}
            disabled={busy}
            placeholder={probe.modality === "explain" ? "Explain in 1–2 sentences…" : "From memory…"}
            className="mt-8 w-full resize-none rounded-2xl border border-ink/15 bg-white/40 p-5 text-lg leading-relaxed shadow-card outline-none transition-colors focus:border-accent disabled:opacity-60 dark:border-ink-dark/20 dark:bg-white/[0.03]"
          />
          <div className="mt-4 flex items-center gap-5">
            <PrimaryButton onClick={submit} busy={busy} disabled={!text.trim()}>
              {busy ? "Grading…" : "Submit"}
            </PrimaryButton>
            {busy ? (
              <Thinking label="grading your answer" />
            ) : (
              <span className="text-xs text-ink/30 dark:text-ink-dark/30">⌘↵ to submit</span>
            )}
          </div>
        </>
      ) : (
        <motion.div {...reveal} className="mt-8">
          <p
            className={`text-sm font-medium uppercase tracking-[0.2em] ${
              result.outcome === "pass"
                ? "text-accent"
                : result.outcome === "partial"
                  ? "text-amber-500"
                  : "text-red-400"
            }`}
          >
            {result.outcome}
          </p>
          {result.note && <p className="mt-1 text-ink/60 dark:text-ink-dark/60">{result.note}</p>}
          <p className="mt-4 rounded-2xl border border-ink/10 bg-white/40 p-5 leading-relaxed shadow-card dark:border-ink-dark/15 dark:bg-white/[0.03]">
            <MathText text={result.canonical} />
          </p>
          {result.corrective ? (
            <Corrective text={result.corrective} onAck={onAdvance} />
          ) : (
            <ContinueButton onClick={onAdvance} />
          )}
        </motion.div>
      )}
    </div>
  );
}

function ContinueButton({ onClick }: { onClick: () => void }) {
  useKey("Enter", onClick);
  return (
    <PrimaryButton className="mt-6" onClick={onClick}>
      Continue
    </PrimaryButton>
  );
}

// --- calibration ---------------------------------------------------------------

function CalibrationView({ sessionId, onDone }: { sessionId: string; onDone: () => void }) {
  const [guess, setGuess] = useState(70);
  const [result, setResult] = useState<{ actual: number; note: string } | null>(null);

  const submit = async () => {
    const r = await post<{ actual: number; note: string }>(`/api/session/${sessionId}/calibration`, { guess });
    setResult(r);
  };

  return (
    <CenterPanel>
      <p className="font-display text-[28px]">How did that go?</p>
      {!result ? (
        <div className="mt-10 w-full max-w-sm">
          <input type="range" min={0} max={100} value={guess} onChange={(e) => setGuess(Number(e.target.value))} />
          <p className="mt-4 font-display text-4xl tabular-nums">{guess}</p>
          <PrimaryButton className="mt-8" onClick={submit}>
            That's my sense
          </PrimaryButton>
        </div>
      ) : (
        <motion.div {...reveal} className="mt-10">
          <p className="font-display text-6xl tabular-nums">
            <CountUp value={result.actual} suffix="%" />
          </p>
          <p className="mt-4 max-w-sm text-ink/60 dark:text-ink-dark/60">{result.note}</p>
          <PrimaryButton className="mt-8" onClick={onDone}>
            Continue
          </PrimaryButton>
        </motion.div>
      )}
    </CenterPanel>
  );
}

// --- end ------------------------------------------------------------------------

function EndView({ finish, onExit, onExtend }: { finish: FinishView; onExit: () => void; onExtend: () => void }) {
  return (
    <CenterPanel>
      <motion.div {...crossfade} className="flex w-full max-w-sm flex-col gap-4">
        {finish.deltas.map((d, i) => (
          <motion.div key={d.goalId} {...staggerOption(i)} className="flex items-baseline justify-between">
            <span className="font-display text-xl">{d.name}</span>
            <span className="text-lg tabular-nums text-ink/70 dark:text-ink-dark/70">
              {d.before}% → <span className="font-semibold text-accent">{d.after}%</span>
            </span>
          </motion.div>
        ))}
        <p className="mt-3 text-ink/50 dark:text-ink-dark/50">
          <CountUp value={finish.minutes} /> min ·{" "}
          {finish.sessionsThisWeek} session{finish.sessionsThisWeek === 1 ? "" : "s"} this week
          {finish.sessionsLastWeek > 0 && ` (${finish.sessionsLastWeek} last week)`}
        </p>
      </motion.div>
      <div className="mt-10 flex items-center gap-5">
        <PrimaryButton onClick={onExit}>Done</PrimaryButton>
        <QuietButton onClick={onExtend}>+5 min</QuietButton>
      </div>
    </CenterPanel>
  );
}
