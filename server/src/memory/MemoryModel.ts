import type { MemoryStateRow, Modality, Outcome } from "../types.js";

/**
 * MemoryModel — the swappable module that owns memory_states.
 *
 * v1 is a per-item FSRS implementation (see fsrs.ts): a "Newtonian
 * approximation" of memory — a closed-form forgetting curve per item, updated
 * from discrete review ratings. It is deliberately wrapped behind this
 * interface so that a future latent-state model can replace it without
 * touching the evidence log, scheduler call-sites, or UI.
 *
 * What a latent-state replacement would do differently:
 *  - consume the raw evidence_events stream (all types, including sweeps and
 *    calibration) instead of a per-item rating scalar;
 *  - maintain a joint posterior over item knowledge, allowing evidence on one
 *    item to update beliefs about related items (the edges table) natively,
 *    replacing the bolted-on propagation experiment;
 *  - expose the same three capabilities below: initialise, update on
 *    evidence, and predict retrievability at a time.
 */
export type Rating = 1 | 2 | 3 | 4; // fail | partial | pass | easy-pass

export interface MemoryModel {
  /** Fresh state for a newly ingested item (state = New, due now). */
  initState(itemId: string, now?: Date): MemoryStateRow;
  /** Apply one review with an FSRS rating; returns the new state. */
  review(state: MemoryStateRow, rating: Rating, now?: Date): MemoryStateRow;
  /** Probability the item can be retrieved at `at` (0–1). New items → 0. */
  retrievability(state: MemoryStateRow, at?: Date): number;
  /**
   * EXPERIMENTAL (propagation, behind settings flag): small multiplicative
   * stability bonus, capped at +10% of current stability.
   */
  applyStabilityBonus(state: MemoryStateRow, fraction: number): MemoryStateRow;
}

/**
 * FSRS rating mapping (the only place outcomes become ratings):
 *   fail = 1, partial = 2, pass = 3 at recognition/cued;
 *   pass at typed/explain = 3, or 4 when response time < learner's median.
 *   Sweep passes log rating 3 (flagged in the evidence payload).
 */
export function outcomeToRating(
  outcome: Outcome,
  modality: Modality,
  fasterThanMedian: boolean
): Rating {
  if (outcome === "fail") return 1;
  if (outcome === "partial") return 2;
  const deep = modality === "typed" || modality === "explain";
  return deep && fasterThanMedian ? 4 : 3;
}
