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
  topic TEXT NOT NULL DEFAULT '',
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
  migrate(db);
  return db;
}

/** Additive migrations for databases created by earlier versions. */
function migrate(d: DB) {
  // ── original migrations ──────────────────────────────────────────────────
  const itemCols = (d.pragma("table_info(items)") as { name: string }[]).map((c) => c.name);
  if (!itemCols.includes("topic")) {
    d.exec("ALTER TABLE items ADD COLUMN topic TEXT NOT NULL DEFAULT ''");
  }

  // Error taxonomy: distinguish blank / near_miss / confident_wrong within fails.
  const evCols = (d.pragma("table_info(evidence_events)") as { name: string }[]).map((c) => c.name);
  if (!evCols.includes("error_type")) {
    d.exec(
      "ALTER TABLE evidence_events ADD COLUMN error_type TEXT CHECK(error_type IN ('blank','near_miss','confident_wrong')) DEFAULT NULL"
    );
  }

  // ── CR-SQLite sync-readiness ─────────────────────────────────────────────
  //
  // evidence_events is the replication unit for future multi-device sync.
  // It must be strictly append-only: no row may ever be updated or deleted.
  // Triggers enforce this at the DB level, protecting log integrity.
  const triggers = (
    d.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as { name: string }[]
  ).map((r) => r.name);

  if (!triggers.includes("no_update_evidence_events")) {
    d.exec(`
      CREATE TRIGGER no_update_evidence_events
      BEFORE UPDATE ON evidence_events
      BEGIN
        SELECT RAISE(ABORT, 'evidence_events is append-only: UPDATE is not permitted');
      END
    `);
  }
  if (!triggers.includes("no_delete_evidence_events")) {
    d.exec(`
      CREATE TRIGGER no_delete_evidence_events
      BEFORE DELETE ON evidence_events
      BEGIN
        SELECT RAISE(ABORT, 'evidence_events is append-only: DELETE is not permitted');
      END
    `);
  }

  // snapshots is also append-only (one row per date+goal, never mutated).
  // The write path uses INSERT OR IGNORE so no UPDATE ever occurs.
  if (!triggers.includes("no_update_snapshots")) {
    d.exec(`
      CREATE TRIGGER no_update_snapshots
      BEFORE UPDATE ON snapshots
      BEGIN
        SELECT RAISE(ABORT, 'snapshots is append-only: UPDATE is not permitted');
      END
    `);
  }
  if (!triggers.includes("no_delete_snapshots")) {
    d.exec(`
      CREATE TRIGGER no_delete_snapshots
      BEFORE DELETE ON snapshots
      BEGIN
        SELECT RAISE(ABORT, 'snapshots is append-only: DELETE is not permitted');
      END
    `);
  }

  // Mutable tables: add updated_at + auto-update trigger for last-write-wins
  // merge semantics when CR-SQLite replication is introduced.
  for (const table of ["items", "edges", "goals", "goal_items"] as const) {
    const cols = (d.pragma(`table_info(${table})`) as { name: string }[]).map((c) => c.name);
    if (!cols.includes("updated_at")) {
      d.exec(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`);
    }
    const tname = `${table}_set_updated_at`;
    if (!triggers.includes(tname)) {
      // Use the table's first PRIMARY KEY column for the WHERE clause.
      const pkCol = table === "edges" ? "item_a" : table === "goal_items" ? "goal_id" : "id";
      d.exec(`
        CREATE TRIGGER ${tname}
        AFTER UPDATE ON ${table}
        FOR EACH ROW
        BEGIN
          UPDATE ${table} SET updated_at = CURRENT_TIMESTAMP WHERE ${pkCol} = NEW.${pkCol};
        END
      `);
    }
  }

  // sync_metadata: namespace for future device-identity and sync-cursor state.
  d.exec(`
    CREATE TABLE IF NOT EXISTS sync_metadata (
      device_id       TEXT NOT NULL,
      last_sync_at    INTEGER,
      schema_version  INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (device_id)
    )
  `);

  // probe_flags: user-reported bad probes excluded from future generation.
  d.exec(`
    CREATE TABLE IF NOT EXISTS probe_flags (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      question TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'bad_probe',
      created_at TEXT NOT NULL
    )
  `);
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
