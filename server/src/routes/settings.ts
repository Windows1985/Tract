import { Router } from "express";
import { z } from "zod";
import { getDailyMinutes, getSetting, propagationEnabled, setSetting } from "../db.js";
import { AnthropicBackend } from "../ai/anthropic.js";
import { AIError } from "../ai/backend.js";
import { DEMO_KEY, isDemoMode } from "../ai/index.js";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json({
    hasKey: getSetting("api_key") !== null,
    demoMode: isDemoMode(),
    dailyMinutes: getDailyMinutes(),
    propagationEnabled: propagationEnabled(),
  });
});

const KeyBody = z.object({ key: z.string().min(1) });

settingsRouter.post("/key", async (req, res) => {
  const parse = KeyBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "A key is required." });
  const key = parse.data.key.trim();
  if (key !== DEMO_KEY) {
    try {
      await new AnthropicBackend(key).validateKey();
    } catch (err) {
      const msg = err instanceof AIError ? err.message : "Could not validate that key.";
      return res.status(400).json({ error: msg });
    }
  }
  setSetting("api_key", key);
  res.json({ ok: true, demoMode: key === DEMO_KEY });
});

const UpdateBody = z.object({
  dailyMinutes: z.number().int().min(3).max(120).optional(),
  propagationEnabled: z.boolean().optional(),
});

settingsRouter.post("/", (req, res) => {
  const parse = UpdateBody.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: "Invalid settings." });
  const { dailyMinutes, propagationEnabled: prop } = parse.data;
  if (dailyMinutes !== undefined) setSetting("daily_minutes", String(dailyMinutes));
  if (prop !== undefined) setSetting("propagation_enabled", String(prop));
  res.json({ ok: true });
});
