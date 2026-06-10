import { Router } from "express";
import { z } from "zod";
import { getDb, nowIso, uid } from "../db.js";
import { getAI } from "../ai/index.js";
import { AIError } from "../ai/backend.js";
import { KindSchema, RelationSchema } from "../types.js";
import { memoryModel } from "../session/engine.js";
import { saveState } from "../memory/store.js";

export const ingestRouter = Router();

const ImageSchema = z.object({ data: z.string(), mediaType: z.string() });
const ExtractBody = z.object({
  text: z.string().default(""),
  image: ImageSchema.nullable().optional(), // legacy single-image shape
  images: z.array(ImageSchema).max(8).optional(),
});

ingestRouter.post("/extract", async (req, res) => {
  const parse = ExtractBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid request." });
  const { text, image, images } = parse.data;
  const allImages = [...(images ?? []), ...(image ? [image] : [])];
  if (!text.trim() && allImages.length === 0)
    return res.status(400).json({ error: "Paste some material first." });
  try {
    const ai = getAI();
    const extraction = await ai.extract(text, allImages);

    // Re-ingesting overlapping material must dedupe: compare candidates to
    // existing item statements and skip duplicates before they're shown.
    const existing = (
      getDb().prepare("SELECT statement FROM items WHERE archived = 0").all() as { statement: string }[]
    ).map((r) => r.statement);
    let skipped = 0;
    let items = extraction.items;
    let edges = extraction.edges;
    if (existing.length > 0 && items.length > 0) {
      const verdicts = await ai.dedupe(
        items.map((i) => i.statement),
        existing.slice(0, 200)
      );
      const dupIdx = new Set(verdicts.verdicts.filter((v) => v.duplicate).map((v) => v.index));
      skipped = dupIdx.size;
      const indexMap = new Map<number, number>();
      const kept: typeof items = [];
      items.forEach((it, i) => {
        if (!dupIdx.has(i)) {
          indexMap.set(i, kept.length);
          kept.push(it);
        }
      });
      items = kept;
      edges = edges
        .filter((e) => indexMap.has(e.a) && indexMap.has(e.b))
        .map((e) => ({ ...e, a: indexMap.get(e.a)!, b: indexMap.get(e.b)! }));
    }
    res.json({ items, edges, richer: extraction.richer, skippedDuplicates: skipped });
  } catch (err) {
    const msg = err instanceof AIError ? err.message : "Extraction failed. Try again.";
    res.status(502).json({ error: msg });
  }
});

const CommitBody = z.object({
  items: z.array(
    z.object({
      statement: z.string().min(3),
      kind: KindSchema,
      distractors: z.array(z.string()).optional(),
    })
  ),
  edges: z
    .array(
      z.object({
        a: z.number().int().nonnegative(),
        b: z.number().int().nonnegative(),
        relation: RelationSchema,
        weight: z.number().min(0).max(1),
      })
    )
    .default([]),
  sourceText: z.string().default(""),
  goal: z
    .union([
      z.object({ id: z.string() }),
      z.object({ name: z.string().min(1), targetDate: z.string().nullable().optional() }),
    ])
    .nullable()
    .optional(),
});

ingestRouter.post("/commit", async (req, res) => {
  const parse = CommitBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid request." });
  const { items, edges, goal, sourceText } = parse.data;
  if (items.length === 0) return res.status(400).json({ error: "Nothing to add." });
  const db = getDb();
  try {
    const ai = getAI();
    // Items edited inline may have lost their cached distractors — regenerate.
    const withDistractors = await Promise.all(
      items.map(async (it) => ({
        ...it,
        distractors:
          it.distractors && it.distractors.length === 3
            ? it.distractors
            : await ai.distractors(it.statement, it.kind),
      }))
    );

    let goalId: string | null = null;
    if (goal) {
      if ("id" in goal) {
        goalId = goal.id;
      } else {
        goalId = uid();
        db.prepare("INSERT INTO goals (id, name, target_date, created_at) VALUES (?, ?, ?, ?)").run(
          goalId,
          goal.name,
          goal.targetDate ?? null,
          nowIso()
        );
      }
    }

    const ids: string[] = [];
    const insertItem = db.prepare(
      "INSERT INTO items (id, statement, kind, source_text, distractors, created_at, archived) VALUES (?, ?, ?, ?, ?, ?, 0)"
    );
    const insertEdge = db.prepare(
      "INSERT OR IGNORE INTO edges (item_a, item_b, relation, weight) VALUES (?, ?, ?, ?)"
    );
    const linkGoal = db.prepare("INSERT OR IGNORE INTO goal_items (goal_id, item_id) VALUES (?, ?)");

    const tx = db.transaction(() => {
      for (const it of withDistractors) {
        const id = uid();
        ids.push(id);
        insertItem.run(id, it.statement, it.kind, sourceText.slice(0, 4000), JSON.stringify(it.distractors), nowIso());
        // New items are immediately probable at the recognition level.
        saveState(memoryModel.initState(id));
        if (goalId) linkGoal.run(goalId, id);
      }
      for (const e of edges) {
        if (ids[e.a] && ids[e.b]) insertEdge.run(ids[e.a], ids[e.b], e.relation, e.weight);
      }
    });
    tx();
    res.json({ ok: true, added: ids.length, goalId });
  } catch (err) {
    const msg = err instanceof AIError ? err.message : "Could not save the items.";
    res.status(502).json({ error: msg });
  }
});
