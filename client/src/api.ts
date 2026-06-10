// Thin typed client for the Tract backend.

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    let msg = "Something went wrong.";
    try {
      const body = await res.json();
      msg = body.error ?? msg;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(msg, res.status);
  }
  return res.json() as Promise<T>;
}

export const get = <T>(path: string) => request<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) });
export const patch = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) });

// --- shared types -----------------------------------------------------------

export type Kind = "fact" | "concept" | "distinction" | "procedure";
export type Modality = "mcq" | "cued" | "typed" | "free_recall" | "explain";
export type Outcome = "pass" | "partial" | "fail";

export interface SettingsView {
  hasKey: boolean;
  demoMode: boolean;
  dailyMinutes: number;
  propagationEnabled: boolean;
}

export interface HomeView {
  hasItems: boolean;
  itemCount: number;
  minutes: number;
  estimatedMinutes: number;
  dueCount: number;
  goals: { id: string; name: string; targetDate: string | null; memory: number; projected: number | null }[];
}

export const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

export interface GoalView {
  id: string;
  name: string;
  targetDate: string | null;
  itemCount: number;
  memory: number;
}

export interface GoalItemView {
  id: string;
  statement: string;
  kind: Kind;
  topic: string;
}

export interface DraftItem {
  statement: string;
  kind: Kind;
  topic?: string;
  distractors: string[];
}

export interface ExtractView {
  items: DraftItem[];
  edges: { a: number; b: number; relation: string; weight: number }[];
  richer: boolean;
  skippedDuplicates: number;
}

export interface SessionStart {
  sessionId: string;
  minutes: number;
  queueLength: number;
  sweep: { goalName: string; itemCount: number } | null;
}

export interface ProbeView {
  done?: boolean;
  index: number;
  total: number;
  itemId: string;
  modality: Modality;
  kind: Kind;
  question: string;
  options?: string[];
  canonical?: string;
  isRetry: boolean;
}

export interface AnswerResult {
  outcome: Outcome;
  note: string | null;
  canonical: string;
  correctIndex?: number;
  corrective: string | null;
  queueLength: number;
}

export interface SweepResult {
  covered: number;
  total: number;
  slipped: string[];
  queueLength: number;
}

export interface FinishView {
  deltas: { goalId: string; name: string; before: number; after: number }[];
  minutes: number;
  sessionsThisWeek: number;
  sessionsLastWeek: number;
}
