import { getDb } from "../db.js";
import type { EvidenceEvent, MemoryStateRow } from "../types.js";
import { FsrsMemoryModel } from "./fsrs.js";
import { outcomeToRating, rescaleRating, type Rating } from "./MemoryModel.js";

// Thin persistence helpers for memory_states (owned by the MemoryModel).

export function loadState(itemId: string): MemoryStateRow | null {
  return (
    (getDb()
      .prepare("SELECT * FROM memory_states WHERE item_id = ?")
      .get(itemId) as MemoryStateRow | undefined) ?? null
  );
}

export function loadStates(itemIds?: string[]): MemoryStateRow[] {
  if (!itemIds) return getDb().prepare("SELECT * FROM memory_states").all() as MemoryStateRow[];
  if (itemIds.length === 0) return [];
  const placeholders = itemIds.map(() => "?").join(",");
  return getDb()
    .prepare(`SELECT * FROM memory_states WHERE item_id IN (${placeholders})`)
    .all(...itemIds) as MemoryStateRow[];
}

/**
 * Rebuild memory_states by replaying the evidence log.
 * Replay MUST read payload.rating, not recompute it — the stored rating may
 * differ from what outcomeToRating would produce today (e.g. per-item median
 * normalization, rescaling changes). Fall back only if payload.rating is absent.
 */
export function replayMemoryStates(): void {
  const db = getDb();
  const model = new FsrsMemoryModel();
  const events = db
    .prepare(
      `SELECT * FROM evidence_events WHERE type IN ('probe','sweep') AND item_id IS NOT NULL AND outcome IS NOT NULL ORDER BY created_at ASC`
    )
    .all() as EvidenceEvent[];

  // Clear derived cache; will be fully rebuilt.
  db.prepare("DELETE FROM memory_states").run();

  // Initialize state for every item that appears in events.
  const stateMap = new Map<string, MemoryStateRow>();
  const ensureState = (itemId: string, at: Date) => {
    if (!stateMap.has(itemId)) {
      stateMap.set(itemId, model.initState(itemId, at));
    }
  };

  for (const ev of events) {
    if (!ev.item_id || !ev.outcome) continue;
    const at = new Date(ev.created_at);
    ensureState(ev.item_id, at);

    if (ev.outcome === "omitted") {
      // Soft decay — doesn't use a rating.
      stateMap.set(ev.item_id, model.applySweepOmission(stateMap.get(ev.item_id)!, at));
      continue;
    }

    // Replay MUST read payload.rating, not recompute it.
    const payload = typeof ev.payload === "string" ? JSON.parse(ev.payload) : (ev.payload as any);
    let rating: Rating;
    if (payload?.rating && [1, 2, 3, 4].includes(payload.rating)) {
      rating = payload.rating as Rating;
    } else {
      // Fallback: recompute from outcome (for events logged before rating was stored).
      const rawRating = outcomeToRating(ev.outcome, ev.modality ?? "mcq", false);
      rating = rescaleRating(rawRating, ev.modality ?? "mcq", ev.outcome);
    }
    stateMap.set(ev.item_id, model.review(stateMap.get(ev.item_id)!, rating, at));
  }

  const tx = db.transaction(() => {
    for (const state of stateMap.values()) saveState(state);
  });
  tx();
}

export function saveState(s: MemoryStateRow) {
  getDb()
    .prepare(
      `INSERT INTO memory_states (item_id, stability, difficulty, due, state, reps, lapses, last_review)
       VALUES (@item_id, @stability, @difficulty, @due, @state, @reps, @lapses, @last_review)
       ON CONFLICT(item_id) DO UPDATE SET
         stability = excluded.stability, difficulty = excluded.difficulty, due = excluded.due,
         state = excluded.state, reps = excluded.reps, lapses = excluded.lapses,
         last_review = excluded.last_review`
    )
    .run(s);
}
