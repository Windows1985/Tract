import { getDb, nowIso, uid } from "./db.js";
import type { EventType, Modality, Outcome } from "./types.js";

// The evidence-event log: the single append-only record of everything
// observed about the learner. Memory model and scheduler consume it.

export function logEvent(e: {
  item_id: string | null;
  type: EventType;
  modality: Modality | null;
  payload: unknown;
  outcome: Outcome | null;
  duration_ms: number | null;
  /** Null for non-fail outcomes; classifies the nature of a typed/explain fail. */
  error_type?: "blank" | "near_miss" | "confident_wrong" | null;
}): string {
  const id = uid();
  getDb()
    .prepare(
      `INSERT INTO evidence_events (id, item_id, type, modality, payload, outcome, duration_ms, created_at, error_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      e.item_id,
      e.type,
      e.modality,
      JSON.stringify(e.payload ?? {}),
      e.outcome,
      e.duration_ms,
      nowIso(),
      e.error_type ?? null
    );
  return id;
}

/** Outcome of the most recent probe on an item (null if never probed). */
export function lastProbeOutcome(itemId: string): Outcome | null {
  const row = getDb()
    .prepare(
      "SELECT outcome FROM evidence_events WHERE item_id = ? AND type = 'probe' ORDER BY created_at DESC LIMIT 1"
    )
    .get(itemId) as { outcome: Outcome | null } | undefined;
  return row?.outcome ?? null;
}

/** Distinct sessions in which the item earned a probe pass (successive relearning). */
export function sessionPassCount(itemId: string): number {
  const rows = getDb()
    .prepare(
      "SELECT payload FROM evidence_events WHERE item_id = ? AND type = 'probe' AND outcome = 'pass'"
    )
    .all(itemId) as { payload: string }[];
  const sessions = new Set<string>();
  for (const r of rows) {
    try {
      const sid = JSON.parse(r.payload).session_id;
      if (sid) sessions.add(sid);
    } catch {
      /* ignore */
    }
  }
  return sessions.size;
}

/** How many items received their first-ever probe today (new-item budget). */
export function newItemsIntroducedToday(): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM (
         SELECT item_id, MIN(created_at) AS first
         FROM evidence_events WHERE type = 'probe' AND item_id IS NOT NULL
         GROUP BY item_id
       ) WHERE date(first) = date('now')`
    )
    .get() as { n: number };
  return row.n;
}

/** Count of probe passes in typed or explain modality (for contrast phasing). */
export function typedExplainPassCount(itemId: string): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM evidence_events
       WHERE item_id = ? AND type = 'probe' AND outcome = 'pass'
         AND modality IN ('typed', 'explain')`
    )
    .get(itemId) as { n: number };
  return row.n;
}

/** Probe questions that have been flagged as bad for this item (excluded from generation). */
export function getFlaggedProbeQuestions(itemId: string): string[] {
  const rows = getDb()
    .prepare("SELECT question FROM probe_flags WHERE item_id = ?")
    .all(itemId) as { question: string }[];
  return rows.map((r) => r.question);
}

/** Probe questions used for an item in the last `days` days (never reuse). */
export function recentProbeQuestions(itemId: string, days = 60): string[] {
  const rows = getDb()
    .prepare(
      `SELECT payload FROM evidence_events
       WHERE item_id = ? AND type = 'probe' AND created_at >= datetime('now', ?)`
    )
    .all(itemId, `-${days} days`) as { payload: string }[];
  const out: string[] = [];
  for (const r of rows) {
    try {
      const q = JSON.parse(r.payload).question;
      if (typeof q === "string") out.push(q);
    } catch {
      /* ignore */
    }
  }
  return out;
}

/** Learner's median response time on passing probes (ms); null if no data. */
export function medianPassDurationMs(): number | null {
  const rows = getDb()
    .prepare(
      "SELECT duration_ms FROM evidence_events WHERE type = 'probe' AND outcome = 'pass' AND duration_ms IS NOT NULL ORDER BY duration_ms"
    )
    .all() as { duration_ms: number }[];
  if (rows.length === 0) return null;
  return rows[Math.floor(rows.length / 2)].duration_ms;
}

/**
 * Per-(item_id, modality) median normalized duration (ms / reference_answer_char).
 * Normalizes by the reference answer length so longer answers don't always
 * look "slow". Falls back to the global median if fewer than 3 events exist
 * for this (item, modality) pair. Returns null if no data at all.
 */
export function medianNormalizedDurationMs(
  itemId: string,
  modality: string,
  referenceAnswerChars: number
): number | null {
  const refLen = Math.max(1, referenceAnswerChars);
  const rows = getDb()
    .prepare(
      `SELECT duration_ms FROM evidence_events
       WHERE item_id = ? AND modality = ? AND type = 'probe' AND outcome = 'pass' AND duration_ms IS NOT NULL
       ORDER BY duration_ms`
    )
    .all(itemId, modality) as { duration_ms: number }[];

  const useGlobal = rows.length < 3;
  const source = useGlobal
    ? (getDb()
        .prepare(
          "SELECT duration_ms FROM evidence_events WHERE type = 'probe' AND outcome = 'pass' AND duration_ms IS NOT NULL ORDER BY duration_ms"
        )
        .all() as { duration_ms: number }[])
    : rows;

  if (source.length === 0) return null;
  const median = source[Math.floor(source.length / 2)].duration_ms;
  return median / refLen;
}

/**
 * Returns the learner's mean overconfidence (guess − actual) across recent
 * calibration events. Positive = overconfident. Returns null if no data.
 */
export function meanCalibrationBias(): number | null {
  const rows = getDb()
    .prepare("SELECT payload FROM evidence_events WHERE type = 'calibration' ORDER BY created_at DESC LIMIT 10")
    .all() as { payload: string }[];
  if (rows.length === 0) return null;
  let sum = 0;
  let n = 0;
  for (const r of rows) {
    try {
      const p = JSON.parse(r.payload);
      if (typeof p.guess === "number" && typeof p.actual === "number") {
        sum += p.guess - p.actual;
        n++;
      }
    } catch {
      /* ignore */
    }
  }
  return n > 0 ? sum / n : null;
}

export function sessionsInWeek(weekOffset: 0 | 1): number {
  // A "session" here = a distinct session_id appearing in calibration events.
  const rows = getDb()
    .prepare("SELECT payload, created_at FROM evidence_events WHERE type = 'calibration'")
    .all() as { payload: string; created_at: string }[];
  const now = Date.now();
  const start = now - (weekOffset + 1) * 7 * 86_400_000;
  const end = now - weekOffset * 7 * 86_400_000;
  const ids = new Set<string>();
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (t > start && t <= end) {
      try {
        ids.add(JSON.parse(r.payload).session_id ?? r.created_at);
      } catch {
        ids.add(r.created_at);
      }
    }
  }
  return ids.size;
}
