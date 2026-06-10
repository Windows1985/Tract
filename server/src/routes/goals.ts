import { Router } from "express";
import { z } from "zod";
import { getDb, nowIso, uid } from "../db.js";
import { goalMeanRetrievability } from "../session/engine.js";

// Topic (goal) management: list, add, rename/redate, delete, and per-topic
// item membership. Deleting a topic never deletes knowledge — items stay,
// only the grouping goes.

export const goalsRouter = Router();

goalsRouter.get("/", (_req, res) => {
  const db = getDb();
  const goals = db.prepare("SELECT * FROM goals ORDER BY created_at").all() as {
    id: string;
    name: string;
    target_date: string | null;
    created_at: string;
  }[];
  res.json({
    goals: goals.map((g) => ({
      id: g.id,
      name: g.name,
      targetDate: g.target_date,
      itemCount: (
        db.prepare("SELECT COUNT(*) AS n FROM goal_items gi JOIN items i ON i.id = gi.item_id WHERE gi.goal_id = ? AND i.archived = 0").get(g.id) as { n: number }
      ).n,
      memory: Math.round(goalMeanRetrievability(g.id) * 100),
    })),
  });
});

const CreateBody = z.object({ name: z.string().min(1).max(120), targetDate: z.string().nullable().optional() });

goalsRouter.post("/", (req, res) => {
  const parse = CreateBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "A topic needs a name." });
  const id = uid();
  getDb()
    .prepare("INSERT INTO goals (id, name, target_date, created_at) VALUES (?, ?, ?, ?)")
    .run(id, parse.data.name.trim(), parse.data.targetDate ?? null, nowIso());
  res.json({ ok: true, id });
});

const UpdateBody = z.object({
  name: z.string().min(1).max(120).optional(),
  targetDate: z.string().nullable().optional(),
});

goalsRouter.patch("/:id", (req, res) => {
  const parse = UpdateBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid update." });
  const db = getDb();
  if (parse.data.name !== undefined)
    db.prepare("UPDATE goals SET name = ? WHERE id = ?").run(parse.data.name.trim(), req.params.id);
  if (parse.data.targetDate !== undefined)
    db.prepare("UPDATE goals SET target_date = ? WHERE id = ?").run(parse.data.targetDate, req.params.id);
  res.json({ ok: true });
});

// Removing a category takes its material out of study: items that belong to
// no other category are archived (never deleted — the evidence log keeps
// their history, and they can be restored from the item browser).
goalsRouter.delete("/:id", (req, res) => {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE items SET archived = 1 WHERE id IN (
         SELECT gi.item_id FROM goal_items gi
         WHERE gi.goal_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM goal_items other
             WHERE other.item_id = gi.item_id AND other.goal_id != ?
           )
       )`
    ).run(req.params.id, req.params.id);
    db.prepare("DELETE FROM goal_items WHERE goal_id = ?").run(req.params.id);
    db.prepare("DELETE FROM snapshots WHERE goal_id = ?").run(req.params.id);
    db.prepare("DELETE FROM goals WHERE id = ?").run(req.params.id);
  });
  tx();
  res.json({ ok: true });
});

goalsRouter.get("/:id/items", (req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.statement, i.kind, i.topic FROM goal_items gi
       JOIN items i ON i.id = gi.item_id
       WHERE gi.goal_id = ? AND i.archived = 0
       ORDER BY i.topic, i.created_at`
    )
    .all(req.params.id);
  res.json({ items: rows });
});

// Remove one topic (subtopic) inside a category: archives its items, freeing
// them from scheduling, except items also covered by another category.
const ArchiveTopicBody = z.object({ topic: z.string() });

goalsRouter.post("/:id/topics/archive", (req, res) => {
  const parse = ArchiveTopicBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid topic." });
  const db = getDb();
  const result = db
    .prepare(
      `UPDATE items SET archived = 1 WHERE topic = ? AND id IN (
         SELECT gi.item_id FROM goal_items gi
         WHERE gi.goal_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM goal_items other
             WHERE other.item_id = gi.item_id AND other.goal_id != ?
           )
       )`
    )
    .run(parse.data.topic, req.params.id, req.params.id);
  res.json({ ok: true, archived: result.changes });
});

goalsRouter.delete("/:id/items/:itemId", (req, res) => {
  getDb().prepare("DELETE FROM goal_items WHERE goal_id = ? AND item_id = ?").run(req.params.id, req.params.itemId);
  res.json({ ok: true });
});

const AddItemBody = z.object({ itemId: z.string() });

goalsRouter.post("/:id/items", (req, res) => {
  const parse = AddItemBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid item." });
  getDb()
    .prepare("INSERT OR IGNORE INTO goal_items (goal_id, item_id) VALUES (?, ?)")
    .run(req.params.id, parse.data.itemId);
  res.json({ ok: true });
});
