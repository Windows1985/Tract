import type { Kind, MemoryStateRow, Modality, SessionPlan } from "../types.js";

/**
 * SchedulerPolicy — the swappable module that decides how today's minutes are
 * spent. The learner makes no pedagogical decisions; this module owns
 * modality, difficulty ordering, interleaving, and timing.
 *
 * v1 (v1.ts) is a rule-based policy over FSRS retrievability. A future policy
 * working against a latent-state memory model would instead optimise expected
 * gain on goal-weighted retrievability directly (a bandit / planning problem
 * over the same evidence log), but would still produce the same SessionPlan
 * shape consumed by the session runner and UI.
 */
export interface SchedulerPolicy {
  /** Compose today's session from the current DB state. */
  buildSession(now?: Date): SessionPlan;
  /** Pick the probe modality an item's memory state warrants. */
  selectModality(
    state: MemoryStateRow,
    kind: Kind,
    retrievability: number,
    lastOutcomeWasFail: boolean
  ): Modality;
}
