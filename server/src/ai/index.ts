import { getSetting } from "../db.js";
import type { AIBackend } from "./backend.js";
import { AnthropicBackend } from "./anthropic.js";
import { MockBackend } from "./mock.js";

export const DEMO_KEY = "demo";

let override: AIBackend | null = null;
let cached: { key: string; backend: AIBackend } | null = null;

/** Tests can inject a backend directly. */
export function setAIBackend(b: AIBackend | null) {
  override = b;
}

export function getAI(): AIBackend {
  if (override) return override;
  const key = getSetting("api_key");
  if (!key) throw new Error("No API key configured");
  if (cached && cached.key === key) return cached.backend;
  const backend = key === DEMO_KEY ? new MockBackend() : new AnthropicBackend(key);
  cached = { key, backend };
  return backend;
}

export function hasKey(): boolean {
  return override !== null || getSetting("api_key") !== null;
}

export function isDemoMode(): boolean {
  return getSetting("api_key") === DEMO_KEY;
}
