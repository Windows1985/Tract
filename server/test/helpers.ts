import { initDb, nowIso, uid } from "../src/db.js";
import type { Kind, MemoryStateRow } from "../src/types.js";
import { State } from "ts-fsrs";

export function freshDb() {
  return initDb(":memory:");
}

export const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
export const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

export function insertItem(opts: {
  statement: string;
  kind?: Kind;
  distractors?: string[];
}): string {
  const id = uid();
  initless()
    .prepare(
      "INSERT INTO items (id, statement, kind, source_text, distractors, created_at, archived) VALUES (?, ?, ?, '', ?, ?, 0)"
    )
    .run(id, opts.statement, opts.kind ?? "fact", JSON.stringify(opts.distractors ?? ["a", "b", "c"]), nowIso());
  return id;
}

import { getDb } from "../src/db.js";
function initless() {
  return getDb();
}

export function setMemoryState(
  itemId: string,
  opts: Partial<MemoryStateRow> & { stability?: number; lastReviewDaysAgo?: number; dueDaysAgo?: number }
) {
  const lastReview = opts.lastReviewDaysAgo !== undefined ? daysAgo(opts.lastReviewDaysAgo) : daysAgo(1);
  const due = opts.dueDaysAgo !== undefined ? daysAgo(opts.dueDaysAgo) : daysAgo(0.1);
  const row: MemoryStateRow = {
    item_id: itemId,
    stability: opts.stability ?? 5,
    difficulty: opts.difficulty ?? 5,
    due: opts.due ?? due,
    state: opts.state ?? State.Review,
    reps: opts.reps ?? 3,
    lapses: opts.lapses ?? 0,
    last_review: opts.last_review !== undefined ? opts.last_review : lastReview,
  };
  getDb()
    .prepare(
      `INSERT INTO memory_states (item_id, stability, difficulty, due, state, reps, lapses, last_review)
       VALUES (@item_id, @stability, @difficulty, @due, @state, @reps, @lapses, @last_review)
       ON CONFLICT(item_id) DO UPDATE SET stability=excluded.stability, difficulty=excluded.difficulty,
         due=excluded.due, state=excluded.state, reps=excluded.reps, lapses=excluded.lapses, last_review=excluded.last_review`
    )
    .run(row);
  return row;
}

export function newMemoryState(itemId: string) {
  return setMemoryState(itemId, {
    stability: 0,
    difficulty: 0,
    state: State.New,
    reps: 0,
    lapses: 0,
    last_review: null,
    due: daysAgo(0),
  });
}

export function addGoal(name: string, targetDate: string | null, itemIds: string[]): string {
  const id = uid();
  getDb().prepare("INSERT INTO goals (id, name, target_date, created_at) VALUES (?, ?, ?, ?)").run(
    id,
    name,
    targetDate,
    nowIso()
  );
  for (const it of itemIds) {
    getDb().prepare("INSERT OR IGNORE INTO goal_items (goal_id, item_id) VALUES (?, ?)").run(id, it);
  }
  return id;
}

export function addEdge(a: string, b: string, relation = "contrasts_with", weight = 0.9) {
  getDb().prepare("INSERT OR IGNORE INTO edges (item_a, item_b, relation, weight) VALUES (?, ?, ?, ?)").run(
    a,
    b,
    relation,
    weight
  );
}
