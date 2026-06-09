import { Router } from "express";
import { getDb } from "../db.js";

// Full JSON dump / restore. The export includes the evidence log itself —
// the universal record — so a restore reproduces the learner exactly.

export const transferRouter = Router();

const TABLES = ["items", "edges", "memory_states", "evidence_events", "goals", "goal_items", "settings", "snapshots"];

transferRouter.get("/export", (_req, res) => {
  const db = getDb();
  const dump: Record<string, unknown[]> = {};
  for (const t of TABLES) dump[t] = db.prepare(`SELECT * FROM ${t}`).all();
  // Never export the API key.
  dump.settings = (dump.settings as { key: string }[]).filter((s) => s.key !== "api_key");
  res.setHeader("Content-Disposition", `attachment; filename="tract-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json({ tract: 1, exported_at: new Date().toISOString(), data: dump });
});

transferRouter.post("/import", (req, res) => {
  const body = req.body;
  if (!body || body.tract !== 1 || typeof body.data !== "object") {
    return res.status(400).json({ error: "That file isn't a Tract export." });
  }
  const db = getDb();
  const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'api_key'").get() as
    | { value: string }
    | undefined;
  const tx = db.transaction(() => {
    for (const t of TABLES) db.prepare(`DELETE FROM ${t}`).run();
    for (const t of TABLES) {
      const rows = (body.data[t] ?? []) as Record<string, unknown>[];
      for (const row of rows) {
        const cols = Object.keys(row);
        db.prepare(`INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(
          ...cols.map((c) => row[c])
        );
      }
    }
    if (apiKey) {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES ('api_key', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).run(apiKey.value);
    }
  });
  try {
    tx();
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "Import failed — the file may be corrupted." });
  }
});
