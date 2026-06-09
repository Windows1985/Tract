import { getDb } from "../db.js";
import type { MemoryStateRow } from "../types.js";

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
