import { Router } from "express";
import { z } from "zod";
import { getDb } from "../db.js";

// Plain searchable item list with archive — lives behind the gear, for
// corrections only. Not on the home path.

export const itemsRouter = Router();

itemsRouter.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : "";
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.statement, i.kind, i.archived, i.created_at
       FROM items i
       WHERE i.statement LIKE ?
       ORDER BY i.created_at DESC
       LIMIT 500`
    )
    .all(`%${q}%`) as any[];
  res.json({ items: rows.map((r) => ({ ...r, archived: !!r.archived })) });
});

itemsRouter.post("/:id/archive", (req, res) => {
  const archived = req.body?.archived === false ? 0 : 1;
  getDb().prepare("UPDATE items SET archived = ? WHERE id = ?").run(archived, req.params.id);
  res.json({ ok: true });
});

const EditBody = z.object({ statement: z.string().min(3) });

itemsRouter.patch("/:id", (req, res) => {
  const parse = EditBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid statement." });
  getDb().prepare("UPDATE items SET statement = ? WHERE id = ?").run(parse.data.statement, req.params.id);
  res.json({ ok: true });
});
