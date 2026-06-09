import { Router } from "express";
import { getDailyMinutes, getDb } from "../db.js";
import { goalMeanRetrievability, memoryModel, scheduler } from "../session/engine.js";
import { loadStates } from "../memory/store.js";

export const homeRouter = Router();

homeRouter.get("/", (_req, res) => {
  const db = getDb();
  const itemCount = (db.prepare("SELECT COUNT(*) AS n FROM items WHERE archived = 0").get() as { n: number }).n;
  const goals = db.prepare("SELECT * FROM goals ORDER BY created_at").all() as {
    id: string;
    name: string;
    target_date: string | null;
  }[];
  const now = new Date();
  const goalViews = goals.map((g) => {
    const projected = g.target_date
      ? (() => {
          const at = new Date(g.target_date!);
          const ids = (db.prepare("SELECT item_id FROM goal_items WHERE goal_id = ?").all(g.id) as { item_id: string }[]).map(
            (r) => r.item_id
          );
          const states = loadStates(ids);
          if (states.length === 0) return null;
          const future = at > now ? at : now;
          return Math.round(
            (states.reduce((acc, s) => acc + memoryModel.retrievability(s, future), 0) / states.length) * 100
          );
        })()
      : null;
    return {
      id: g.id,
      name: g.name,
      targetDate: g.target_date,
      memory: Math.round(goalMeanRetrievability(g.id, now) * 100),
      projected,
    };
  });
  // Estimate today's load without mutating anything.
  const plan = itemCount > 0 ? scheduler.buildSession(now) : null;
  res.json({
    hasItems: itemCount > 0,
    itemCount,
    minutes: getDailyMinutes(),
    estimatedMinutes: plan
      ? Math.max(1, Math.min(getDailyMinutes(), Math.round((plan.queue.length * 35 + (plan.sweep ? 90 : 0)) / 60)))
      : 0,
    dueCount: plan?.queue.length ?? 0,
    goals: goalViews,
  });
});
