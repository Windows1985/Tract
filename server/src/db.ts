import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// One SQLite file, local only, no auth. The evidence_events table is the
// universal log: every observation about the learner's knowledge is appended
// here in one format; the memory model and scheduler are consumers of it.

export type DB = Database.Database;

let db: DB | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  statement TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fact','concept','distinction','procedure')),
  source_text TEXT,
  distractors TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS edges (
  item_a TEXT NOT NULL,
  item_b TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('contrasts_with','depends_on','related_to')),
  weight REAL NOT NULL DEFAULT 0.5,
  PRIMARY KEY (item_a, item_b, relation)
);
CREATE TABLE IF NOT EXISTS memory_states (
  item_id TEXT PRIMARY KEY,
  stability REAL NOT NULL,
  difficulty REAL NOT NULL,
  due TEXT NOT NULL,
  state INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  lapses INTEGER NOT NULL,
  last_review TEXT
);
CREATE TABLE IF NOT EXISTS evidence_events (
  id TEXT PRIMARY KEY,
  item_id TEXT,
  type TEXT NOT NULL CHECK (type IN ('probe','sweep','correction','calibration')),
  modality TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  outcome TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_item ON evidence_events(item_id, created_at);
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  target_date TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS goal_items (
  goal_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  PRIMARY KEY (goal_id, item_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  date TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  projected_score REAL NOT NULL,
  PRIMARY KEY (date, goal_id)
);
`;

export function initDb(file?: string): DB {
  const target = file ?? path.resolve(process.cwd(), "../data/tract.db");
  if (target !== ":memory:") {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  db = new Database(target);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

export function getDb(): DB {
  if (!db) throw new Error("Database not initialised — call initDb() first");
  return db;
}

export function setDb(d: DB) {
  db = d;
}

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();

// --- settings helpers -------------------------------------------------------

export function getSetting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    )
    .run(key, value);
}

export const DEFAULT_DAILY_MINUTES = 12;

export function getDailyMinutes(): number {
  const v = getSetting("daily_minutes");
  return v ? Number(v) : DEFAULT_DAILY_MINUTES;
}

export function propagationEnabled(): boolean {
  return getSetting("propagation_enabled") === "true";
}
