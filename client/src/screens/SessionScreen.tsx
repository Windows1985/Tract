import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
import { CountUp, PrimaryButton, PulsePlaceholder, QuietButton, TimerRing } from "../components/widgets";

type Phase = "starting" | "sweep" | "sweepResult" | "probe" | "calibration" | "end" | "empty";

const SWEEP_SECONDS = 90;

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
        const s = await post<SessionStart>("/api/session/start");
        setSession(s);
        if (s.sweep) setPhase("sweep");
        else if (s.queueLength === 0) setPhase("empty");
        else setPhase("probe");
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
    if (r.added > 0) setPhase("probe");
  };

  if (error)
    return (
      <CenterPanel>
        <p className="text-lg">{error}</p>
        <PrimaryButton className="mt-6" onClick={onExit}>
          Back
        </PrimaryButton>
      </CenterPanel>
    );

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6">
      <AnimatePresence mode="wait">
        {phase === "starting" && (
          <motion.div key="starting" {...fade} className="flex flex-1 items-center justify-center">
            <PulsePlaceholder />
          </motion.div>
        )}

        {phase === "empty" && (
          <CenterPanel key="empty">
            <p className="text-xl">Nothing is due right now. Come back tomorrow — or add material.</p>
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
            <p className="text-2xl leading-relaxed">
              You covered {sweepResult.covered} of {sweepResult.total}.
            </p>
            {sweepResult.slipped.length > 0 && (
              <div className="mt-6 text-left">
                <p className="text-sm uppercase tracking-wide text-ink/40 dark:text-ink-dark/40">These slipped</p>
                <ul className="mt-2 flex flex-col gap-1.5 text-ink/70 dark:text-ink-dark/70">
                  {sweepResult.slipped.slice(0, 6).map((s, i) => (
                    <li key={i} className="leading-snug">
                      · <MathText text={s} />
                    </li>
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
        <p className="text-[28px] font-medium leading-snug">
          Write everything you know about <span className="text-accent">{goalName}</span>.
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
        placeholder="Everything. Fragments are fine."
        className="mt-8 w-full resize-none rounded-2xl border border-ink/15 bg-transparent p-5 text-lg leading-relaxed outline-none transition-colors focus:border-accent dark:border-ink-dark/20"
      />
      <div className="mt-6">
        <PrimaryButton onClick={submit} disabled={busy}>
          {busy ? "Reading…" : "Done"}
        </PrimaryButton>
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
      <p className="mb-6 text-xs uppercase tracking-widest text-ink/35 dark:text-ink-dark/35">
        {probe.index + 1} / {probe.total}
        {probe.isRetry && " · again"}
      </p>
      {probe.modality === "mcq" && <McqProbe key={probe.index} sessionId={sessionId} probe={probe} onAdvance={onAdvance} />}
      {probe.modality === "cued" && <CuedProbe key={probe.index} sessionId={sessionId} probe={probe} onAdvance={onAdvance} />}
      {(probe.modality === "typed" || probe.modality === "explain") && (
        <TypedProbe key={probe.index} sessionId={sessionId} probe={probe} onAdvance={onAdvance} />
      )}
    </motion.div>
  );
}

function Corrective({ text, onAck }: { text: string; onAck: () => void }) {
  useKey("Enter", onAck);
  return (
    <motion.div {...reveal} className="mt-8 rounded-2xl border border-accent/30 bg-accent/5 p-5">
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

  const pick = async (i: number) => {
    if (picked !== null) return;
    setPicked(i);
    const r = await post<AnswerResult>(`/api/session/${sessionId}/answer`, {
      index: probe.index,
      durationMs: Date.now() - started.current,
      optionIndex: i,
    });
    setResult(r);
    if (r.outcome === "pass") setTimeout(onAdvance, 700);
  };

  return (
    <div>
      <p className="text-[28px] font-medium leading-snug">
        <MathText text={probe.question} />
      </p>
      <div className="mt-8 flex flex-col gap-3">
        {(probe.options ?? []).map((opt, i) => {
          const isCorrect = result && i === result.correctIndex;
          const isWrongPick = result && picked === i && i !== result.correctIndex;
          return (
            <motion.button
              key={i}
              {...staggerOption(i)}
              onClick={() => pick(i)}
              disabled={picked !== null}
              className={`rounded-xl border px-5 py-3.5 text-left leading-snug transition-colors ${
                isCorrect
                  ? "border-accent bg-accent/10"
                  : isWrongPick
                    ? "border-red-400/60 bg-red-400/5"
                    : "border-ink/15 hover:border-accent/60 dark:border-ink-dark/20"
              }`}
            >
              <MathText text={opt} />
            </motion.button>
          );
        })}
      </div>
      {result?.corrective && <Corrective text={result.corrective} onAck={onAdvance} />}
    </div>
  );
}

function CuedProbe({ sessionId, probe, onAdvance }: { sessionId: string; probe: ProbeView; onAdvance: () => void }) {
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const started = useRef(Date.now());

  const rate = async (selfRating: Outcome) => {
    if (result) return;
    const r = await post<AnswerResult>(`/api/session/${sessionId}/answer`, {
      index: probe.index,
      durationMs: Date.now() - started.current,
      selfRating,
    });
    setResult(r);
    if (selfRating !== "fail") onAdvance();
  };

  useKey("Enter", !revealed ? () => setRevealed(true) : null);
  useKey("1", revealed && !result ? () => rate("pass") : null);
  useKey("2", revealed && !result ? () => rate("partial") : null);
  useKey("3", revealed && !result ? () => rate("fail") : null);

  return (
    <div>
      <p className="text-[28px] font-medium leading-snug">
        <MathText text={probe.question} />
      </p>
      {!revealed ? (
        <div className="mt-10">
          <p className="text-sm text-ink/40 dark:text-ink-dark/40">Think it through, then reveal.</p>
          <PrimaryButton className="mt-3" onClick={() => setRevealed(true)}>
            Reveal
          </PrimaryButton>
        </div>
      ) : (
        <motion.div {...reveal} className="mt-10">
          <p className="rounded-2xl border border-ink/10 p-5 text-lg leading-relaxed dark:border-ink-dark/15">
            <MathText text={probe.canonical ?? ""} />
          </p>
          {!result && (
            <div className="mt-6 flex gap-3">
              {(
                [
                  ["pass", "Knew it", "1"],
                  ["partial", "Partly", "2"],
                  ["fail", "Didn't", "3"],
                ] as const
              ).map(([rating, label, k]) => (
                <button
                  key={rating}
                  onClick={() => rate(rating)}
                  className="flex-1 rounded-xl border border-ink/15 px-4 py-3 transition-colors hover:border-accent dark:border-ink-dark/20"
                >
                  {label} <span className="ml-1 text-xs text-ink/30 dark:text-ink-dark/30">{k}</span>
                </button>
              ))}
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
      <p className="text-[28px] font-medium leading-snug">
        <MathText text={probe.question} />
      </p>
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
            placeholder={probe.modality === "explain" ? "Explain in 1–2 sentences…" : "From memory…"}
            className="mt-8 w-full resize-none rounded-2xl border border-ink/15 bg-transparent p-5 text-lg leading-relaxed outline-none transition-colors focus:border-accent dark:border-ink-dark/20"
          />
          <PrimaryButton className="mt-4" onClick={submit} disabled={busy || !text.trim()}>
            {busy ? "Grading…" : "Submit"}
          </PrimaryButton>
        </>
      ) : (
        <motion.div {...reveal} className="mt-8">
          <p
            className={`text-sm font-medium uppercase tracking-wide ${
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
          <p className="mt-4 rounded-2xl border border-ink/10 p-5 leading-relaxed dark:border-ink-dark/15">
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
      <p className="text-[28px] font-medium">How did that go?</p>
      {!result ? (
        <div className="mt-10 w-full max-w-sm">
          <input type="range" min={0} max={100} value={guess} onChange={(e) => setGuess(Number(e.target.value))} />
          <p className="mt-3 text-3xl font-medium tabular-nums">{guess}</p>
          <PrimaryButton className="mt-8" onClick={submit}>
            That's my sense
          </PrimaryButton>
        </div>
      ) : (
        <motion.div {...reveal} className="mt-10">
          <p className="text-5xl font-semibold tabular-nums">
            <CountUp value={result.actual} suffix="%" />
          </p>
          <p className="mt-3 max-w-sm text-ink/60 dark:text-ink-dark/60">{result.note}</p>
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
        {finish.deltas.map((d) => (
          <div key={d.goalId} className="flex items-baseline justify-between">
            <span className="text-lg">{d.name}</span>
            <span className="text-lg tabular-nums text-ink/70 dark:text-ink-dark/70">
              {d.before}% → <span className="font-semibold text-accent">{d.after}%</span>
            </span>
          </div>
        ))}
        <p className="mt-2 text-ink/50 dark:text-ink-dark/50">
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
