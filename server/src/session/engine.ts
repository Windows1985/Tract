import { getDb, propagationEnabled, uid } from "../db.js";
import { getAI } from "../ai/index.js";
import { logEvent, medianPassDurationMs, recentProbeQuestions } from "../evidence.js";
import { loadState, loadStates, saveState } from "../memory/store.js";
import { FsrsMemoryModel } from "../memory/fsrs.js";
import { outcomeToRating, rescaleRating } from "../memory/MemoryModel.js";
import { V1Scheduler } from "../scheduler/v1.js";
import type { Item, Kind, Modality, Outcome, QueueEntry, SessionPlan } from "../types.js";
import { State } from "ts-fsrs";

// In-memory session runner. A session is ephemeral compose-and-run state;
// everything durable goes through the evidence log and memory_states.

export interface ProbeView {
  index: number;
  total: number;
  itemId: string;
  modality: Modality;
  kind: Kind;
  question: string;
  options?: string[]; // mcq only (shuffled, includes the true statement)
  canonical?: string; // cued only — needed client-side for think→reveal
  isRetry: boolean;
}

interface CachedProbe {
  question: string;
  options?: string[];
  correctIndex?: number;
}

export interface Session {
  id: string;
  startedAt: number;
  plan: SessionPlan;
  sweepDone: boolean;
  probes: Map<number, CachedProbe>;
  inflight: Map<number, Promise<CachedProbe>>;
  results: { itemId: string; outcome: Outcome; isRetry: boolean }[];
  retryCount: Map<string, number>;
  goalStartR: Map<string, number>;
}

const sessions = new Map<string, Session>();

export const memoryModel = new FsrsMemoryModel();
export const scheduler = new V1Scheduler(memoryModel);

export function getSession(id: string): Session {
  const s = sessions.get(id);
  if (!s) throw new Error("Session not found (it may have expired — start again)");
  return s;
}

export function goalMeanRetrievability(goalId: string, at: Date = new Date()): number {
  const ids = (getDb().prepare("SELECT item_id FROM goal_items WHERE goal_id = ?").all(goalId) as { item_id: string }[]).map(
    (r) => r.item_id
  );
  const states = loadStates(ids);
  if (states.length === 0) return 0;
  return states.reduce((acc, s) => acc + memoryModel.retrievability(s, at), 0) / states.length;
}

export function startSession(now: Date = new Date()): Session {
  writeDailySnapshots(now);
  const plan = scheduler.buildSession(now);
  const goals = getDb().prepare("SELECT id FROM goals").all() as { id: string }[];
  const goalStartR = new Map(goals.map((g) => [g.id, goalMeanRetrievability(g.id, now)]));
  const session: Session = {
    id: uid(),
    startedAt: now.getTime(),
    plan,
    sweepDone: !plan.sweep,
    probes: new Map(),
    inflight: new Map(),
    results: [],
    retryCount: new Map(),
    goalStartR,
  };
  // Prune sessions older than 6 hours — durable truth lives in the log.
  for (const [id, s] of sessions) {
    if (now.getTime() - s.startedAt > 6 * 3600_000) sessions.delete(id);
  }
  sessions.set(session.id, session);
  return session;
}

/** Daily on-start job: snapshot each goal's projected score. */
function writeDailySnapshots(now: Date) {
  const db = getDb();
  const goals = db.prepare("SELECT * FROM goals").all() as { id: string; target_date: string | null }[];
  const today = now.toISOString().slice(0, 10);
  for (const g of goals) {
    const at = g.target_date ? new Date(g.target_date) : now;
    const projected = goalMeanRetrievability(g.id, at > now ? at : now);
    db.prepare(
      "INSERT INTO snapshots (date, goal_id, projected_score) VALUES (?, ?, ?) ON CONFLICT(date, goal_id) DO UPDATE SET projected_score = excluded.projected_score"
    ).run(today, g.id, projected);
  }
}

function getItem(itemId: string): Item {
  const row = getDb().prepare("SELECT * FROM items WHERE id = ?").get(itemId) as any;
  if (!row) throw new Error("Item not found");
  return { ...row, distractors: JSON.parse(row.distractors || "[]"), archived: !!row.archived };
}

// --- sweep -------------------------------------------------------------------

export async function submitSweep(session: Session, dump: string, durationMs: number) {
  const sweep = session.plan.sweep;
  if (!sweep) throw new Error("This session has no sweep");
  if (session.sweepDone) throw new Error("Sweep already submitted");
  const items = sweep.itemIds.map((id) => ({ id, statement: getItem(id).statement }));
  const diff = await getAI().sweepDiff(sweep.goalName, items, dump);
  const verdictById = new Map(diff.verdicts.map((v) => [v.item_id, v.verdict]));

  const slipped: { itemId: string; statement: string; verdict: string }[] = [];
  let covered = 0;
  for (const it of items) {
    const verdict = verdictById.get(it.id) ?? "omitted";
    if (verdict === "mentioned_correct") {
      covered++;
      // One sweep services many items: each correct mention is a pass.
      // Sweep passes log rating 3, then rescaled (free_recall cap = 3).
      const state = loadState(it.id);
      if (state && state.state !== State.New) {
        saveState(memoryModel.review(state, rescaleRating(3, "free_recall", "pass")));
      }
      logEvent({
        item_id: it.id,
        type: "sweep",
        modality: "free_recall",
        payload: { session_id: session.id, verdict, rating: 3, sweep_pass: true, goal_id: sweep.goalId },
        outcome: "pass",
        duration_ms: null,
      });
    } else {
      slipped.push({ itemId: it.id, statement: getItem(it.id).statement, verdict });
      logEvent({
        item_id: it.id,
        type: "sweep",
        modality: "free_recall",
        payload: { session_id: session.id, verdict, goal_id: sweep.goalId },
        outcome: verdict === "mentioned_wrong" ? "fail" : null,
        duration_ms: null,
      });
      // Wrong/omitted items are queued for probing today (front of queue,
      // recognition level for wrong answers — they just failed).
      if (!session.plan.queue.some((q) => q.itemId === it.id)) {
        session.plan.queue.unshift({
          itemId: it.id,
          modality: verdict === "mentioned_wrong" ? "mcq" : "cued",
          isRetry: false,
        });
        reindexProbes(session, 0);
      }
    }
  }
  // Sweep-level event (item_id null): the dump itself.
  logEvent({
    item_id: null,
    type: "sweep",
    modality: "free_recall",
    payload: { session_id: session.id, goal_id: sweep.goalId, dump, covered, total: items.length },
    outcome: null,
    duration_ms: durationMs,
  });
  session.sweepDone = true;
  return { covered, total: items.length, slipped: slipped.map((s) => s.statement) };
}

function reindexProbes(session: Session, insertedAt: number) {
  // Queue indices shifted; drop cached/inflight probes at or after the insert point.
  const shift = (m: Map<number, any>) => {
    const entries = [...m.entries()];
    m.clear();
    for (const [k, v] of entries) m.set(k >= insertedAt ? k + 1 : k, v);
  };
  shift(session.probes);
  shift(session.inflight);
}

// --- probes ------------------------------------------------------------------

const shuffle = <T>(arr: T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

async function generateProbe(session: Session, index: number): Promise<CachedProbe> {
  const entry = session.plan.queue[index];
  if (!entry) throw new Error("No probe at that index");
  const item = getItem(entry.itemId);
  const avoid = recentProbeQuestions(entry.itemId, 60);
  const ai = getAI();

  if (entry.modality === "mcq") {
    const [{ question }, freshDistractors] = await Promise.all([
      ai.probe("mcq", item.statement, null, avoid),
      entry.isRetry ? ai.distractors(item.statement, item.kind) : Promise.resolve(null),
    ]);
    const distractors = freshDistractors ?? item.distractors.slice(0, 3);
    const options = shuffle([item.statement, ...distractors]);
    return { question, options, correctIndex: options.indexOf(item.statement) };
  }
  if (entry.modality === "cued") {
    const { question } = await ai.probe("cued", item.statement, null, avoid);
    return { question };
  }
  if (entry.modality === "explain") {
    const { question } = await ai.probe("explain", item.statement, null, avoid);
    return { question };
  }
  // typed — distinction items prefer contrast probes
  if (item.kind === "distinction" || entry.contrastItemId) {
    const contrast = entry.contrastItemId ? getItem(entry.contrastItemId).statement : null;
    if (item.kind === "distinction") {
      const { question } = await ai.probe("contrast", item.statement, contrast, avoid);
      return { question };
    }
  }
  const { question } = await ai.probe("typed", item.statement, null, avoid);
  return { question };
}

/** Probe N+1 is pre-fetched while the learner answers probe N. */
export async function getProbe(session: Session, index: number): Promise<ProbeView> {
  const entry = session.plan.queue[index];
  if (!entry) throw new Error("No probe at that index");
  let probe = session.probes.get(index);
  if (!probe) {
    let pending = session.inflight.get(index);
    if (!pending) {
      pending = generateProbe(session, index);
      session.inflight.set(index, pending);
    }
    probe = await pending;
    session.probes.set(index, probe);
    session.inflight.delete(index);
  }
  // Kick off background generation of the next probe (prefetch).
  const nextIdx = index + 1;
  if (nextIdx < session.plan.queue.length && !session.probes.has(nextIdx) && !session.inflight.has(nextIdx)) {
    const pending = generateProbe(session, nextIdx)
      .then((p) => {
        session.probes.set(nextIdx, p);
        session.inflight.delete(nextIdx);
        return p;
      })
      .catch((e) => {
        session.inflight.delete(nextIdx);
        throw e;
      });
    session.inflight.set(nextIdx, pending.catch(() => ({ question: "" }) as CachedProbe));
  }
  const item = getItem(entry.itemId);
  return {
    index,
    total: session.plan.queue.length,
    itemId: entry.itemId,
    modality: entry.modality,
    kind: item.kind,
    question: probe.question,
    options: probe.options,
    canonical: entry.modality === "cued" ? item.statement : undefined,
    isRetry: entry.isRetry,
  };
}

// --- answers -----------------------------------------------------------------

export interface AnswerResult {
  outcome: Outcome;
  note: string | null;
  canonical: string;
  correctIndex?: number;
  corrective: string | null;
  queueLength: number;
}

export async function submitAnswer(
  session: Session,
  index: number,
  durationMs: number,
  response: { optionIndex?: number; selfRating?: Outcome; text?: string }
): Promise<AnswerResult> {
  const entry = session.plan.queue[index];
  if (!entry) throw new Error("No probe at that index");
  const probe = session.probes.get(index);
  if (!probe) throw new Error("Probe was never fetched");
  const item = getItem(entry.itemId);

  let outcome: Outcome;
  let note: string | null = null;
  let answerText: string | null = null;

  if (entry.modality === "mcq") {
    answerText = probe.options?.[response.optionIndex ?? -1] ?? null;
    outcome = response.optionIndex === probe.correctIndex ? "pass" : "fail";
  } else if (entry.modality === "cued") {
    // Think → reveal → one-tap self-confirm (1/2/3).
    if (!response.selfRating) throw new Error("selfRating required for cued probes");
    outcome = response.selfRating;
  } else {
    answerText = response.text ?? "";
    const grade = await getAI().grade(item.statement, probe.question, answerText);
    outcome = grade.outcome;
    note = grade.note;
  }

  // FSRS update through the MemoryModel.
  const median = medianPassDurationMs();
  const fast = median !== null && durationMs < median;
  const rawRating = outcomeToRating(outcome, entry.modality, fast);
  const rating = rescaleRating(rawRating, entry.modality, outcome);
  const state = loadState(entry.itemId);
  if (state) {
    const updated = memoryModel.review(state, rating);
    saveState(updated);
    // EXPERIMENTAL propagation (off by default): on a pass, a small stability
    // bonus (≤10% of the normal update) to strongly connected neighbours.
    if (outcome === "pass" && propagationEnabled()) {
      const neighbours = getDb()
        .prepare(
          "SELECT item_a, item_b, weight FROM edges WHERE (item_a = ? OR item_b = ?) AND weight >= 0.7"
        )
        .all(entry.itemId, entry.itemId) as { item_a: string; item_b: string; weight: number }[];
      for (const e of neighbours) {
        const otherId = e.item_a === entry.itemId ? e.item_b : e.item_a;
        const other = loadState(otherId);
        if (other && other.state !== State.New) {
          saveState(memoryModel.applyStabilityBonus(other, 0.05 * e.weight));
        }
      }
    }
  }

  logEvent({
    item_id: entry.itemId,
    type: "probe",
    modality: entry.modality,
    payload: {
      session_id: session.id,
      question: probe.question,
      options: probe.options,
      answer: answerText ?? response.selfRating ?? null,
      verdict_note: note,
      rating,
      retry: entry.isRetry,
    },
    outcome,
    duration_ms: durationMs,
  });
  session.results.push({ itemId: entry.itemId, outcome, isRetry: entry.isRetry });

  // Error loop-back: corrective explanation, then the item returns near the
  // session's end as a recognition-level re-probe. Never end a session with
  // an item left failed.
  let corrective: string | null = null;
  if (outcome === "fail") {
    const c = await getAI().corrective(item.statement, probe.question, answerText);
    corrective = c.explanation;
    logEvent({
      item_id: entry.itemId,
      type: "correction",
      modality: entry.modality,
      payload: { session_id: session.id, explanation: corrective, question: probe.question },
      outcome: null,
      duration_ms: null,
    });
    const retries = session.retryCount.get(entry.itemId) ?? 0;
    if (retries < 2) {
      session.retryCount.set(entry.itemId, retries + 1);
      session.plan.queue.push({ itemId: entry.itemId, modality: "mcq", isRetry: true });
    }
  }

  return {
    outcome,
    note,
    canonical: item.statement,
    correctIndex: probe.correctIndex,
    corrective,
    queueLength: session.plan.queue.length,
  };
}

// --- calibration + finish ------------------------------------------------------

export function sessionAccuracy(session: Session): number {
  const scored = session.results;
  if (scored.length === 0) return 0;
  const points = scored.reduce(
    (acc, r) => acc + (r.outcome === "pass" ? 1 : r.outcome === "partial" ? 0.5 : 0),
    0
  );
  return points / scored.length;
}

export function submitCalibration(session: Session, guess: number): { actual: number; note: string } {
  const actual = Math.round(sessionAccuracy(session) * 100);
  const diff = guess - actual;
  const note =
    Math.abs(diff) <= 8
      ? "Well calibrated — your sense of it matches reality."
      : diff > 0
        ? `You felt ${diff} points better than you scored — watch for fluency illusions.`
        : `You scored ${-diff} points better than it felt — you know more than you think.`;
  logEvent({
    item_id: null,
    type: "calibration",
    modality: null,
    payload: { session_id: session.id, guess, actual },
    outcome: null,
    duration_ms: null,
  });
  return { actual, note };
}

export function finishSession(session: Session) {
  const db = getDb();
  const goals = db.prepare("SELECT * FROM goals").all() as { id: string; name: string }[];
  const deltas = goals.map((g) => ({
    goalId: g.id,
    name: g.name,
    before: Math.round((session.goalStartR.get(g.id) ?? 0) * 100),
    after: Math.round(goalMeanRetrievability(g.id) * 100),
  }));
  const minutes = Math.max(1, Math.round((Date.now() - session.startedAt) / 60_000));
  return { deltas, minutes };
}

/** "+5 min": extend the current session with more due/new items. */
export function extendSession(session: Session): number {
  const extraPlan = scheduler.buildSession();
  const inQueue = new Set(session.plan.queue.map((q) => q.itemId));
  let added = 0;
  for (const e of extraPlan.queue) {
    if (added >= 8) break;
    if (!inQueue.has(e.itemId)) {
      session.plan.queue.push(e);
      added++;
    }
  }
  return added;
}
