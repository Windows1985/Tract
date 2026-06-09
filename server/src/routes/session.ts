import { Router } from "express";
import { z } from "zod";
import {
  extendSession,
  finishSession,
  getProbe,
  getSession,
  startSession,
  submitAnswer,
  submitCalibration,
  submitSweep,
} from "../session/engine.js";
import { AIError } from "../ai/backend.js";
import { OutcomeSchema } from "../types.js";
import { sessionsInWeek } from "../evidence.js";

export const sessionRouter = Router();

const handleErr = (res: any, err: unknown) => {
  if (err instanceof AIError) return res.status(502).json({ error: err.message });
  return res.status(400).json({ error: err instanceof Error ? err.message : "Request failed" });
};

sessionRouter.post("/start", (_req, res) => {
  try {
    const s = startSession();
    res.json({
      sessionId: s.id,
      minutes: s.plan.minutes,
      queueLength: s.plan.queue.length,
      sweep: s.plan.sweep ? { goalName: s.plan.sweep.goalName, itemCount: s.plan.sweep.itemIds.length } : null,
    });
  } catch (err) {
    handleErr(res, err);
  }
});

const SweepBody = z.object({ dump: z.string(), durationMs: z.number().int().nonnegative() });

sessionRouter.post("/:id/sweep", async (req, res) => {
  try {
    const s = getSession(req.params.id);
    const body = SweepBody.parse(req.body);
    const result = await submitSweep(s, body.dump, body.durationMs);
    res.json({ ...result, queueLength: s.plan.queue.length });
  } catch (err) {
    handleErr(res, err);
  }
});

sessionRouter.get("/:id/probe/:index", async (req, res) => {
  try {
    const s = getSession(req.params.id);
    const index = Number(req.params.index);
    if (index >= s.plan.queue.length) return res.json({ done: true, total: s.plan.queue.length });
    const probe = await getProbe(s, index);
    res.json(probe);
  } catch (err) {
    handleErr(res, err);
  }
});

const AnswerBody = z.object({
  index: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  optionIndex: z.number().int().optional(),
  selfRating: OutcomeSchema.optional(),
  text: z.string().optional(),
});

sessionRouter.post("/:id/answer", async (req, res) => {
  try {
    const s = getSession(req.params.id);
    const body = AnswerBody.parse(req.body);
    const result = await submitAnswer(s, body.index, body.durationMs, body);
    res.json(result);
  } catch (err) {
    handleErr(res, err);
  }
});

const CalibrationBody = z.object({ guess: z.number().min(0).max(100) });

sessionRouter.post("/:id/calibration", (req, res) => {
  try {
    const s = getSession(req.params.id);
    const body = CalibrationBody.parse(req.body);
    res.json(submitCalibration(s, body.guess));
  } catch (err) {
    handleErr(res, err);
  }
});

sessionRouter.post("/:id/finish", (req, res) => {
  try {
    const s = getSession(req.params.id);
    const result = finishSession(s);
    res.json({
      ...result,
      sessionsThisWeek: sessionsInWeek(0),
      sessionsLastWeek: sessionsInWeek(1),
    });
  } catch (err) {
    handleErr(res, err);
  }
});

sessionRouter.post("/:id/extend", (req, res) => {
  try {
    const s = getSession(req.params.id);
    const added = extendSession(s);
    res.json({ added, queueLength: s.plan.queue.length });
  } catch (err) {
    handleErr(res, err);
  }
});
