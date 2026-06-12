import type { MemoryStateRow, Modality, Outcome } from "../types.js";

/**
 * MemoryModel — the swappable module that owns memory_states.
 *
 * SYNC NOTE: memory_states is a DERIVED CACHE, not source-of-truth data.
 * It can be deleted and fully rebuilt by replaying evidence_events through
 * the MemoryModel interface. This property is critical for CR-SQLite sync:
 * memory_states does not need to be replicated — each device reconstructs
 * it locally from the replicated evidence log.
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
  /**
   * Soft stability decay for an omitted sweep item (not recalled in a sweep,
   * but not actively wrong). Decays stability by ~half what a fail would do
   * so the item moves earlier in the queue without being treated as a lapse.
   */
  applySweepOmission(state: MemoryStateRow, now?: Date): MemoryStateRow;
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
  if (outcome === "fail" || outcome === "omitted") return 1;
  if (outcome === "partial") return 2;
  const deep = modality === "typed" || modality === "explain";
  return deep && fasterThanMedian ? 4 : 3;
}

/**
 * Per-modality rescaling applied immediately before a rating enters ts-fsrs.
 * The raw rating is computed by outcomeToRating; this function adjusts it to
 * account for the structural difference in evidence quality across modalities:
 *
 *  free_recall  pass       → cap at 3 (sweep evidence is less confident than
 *                             a direct probe; prevents over-crediting)
 *  typed/explain fail      → 1 (high-bar modality; a miss is strong evidence
 *                             of forgetting — already the default, made explicit)
 *  typed/explain pass fast → 4 (pass-through; outcomeToRating already set this)
 *  mcq/cued any outcome    → pass-through unchanged
 *
 * Does NOT change the evidence_events log format — rescaling is at the
 * ts-fsrs call site only.
 */
export function rescaleRating(rawRating: Rating, modality: Modality, outcome: Outcome): Rating {
  if (modality === "free_recall") {
    // Sweeps are lower-confidence: cap pass at 3, keep fail/partial as-is.
    return Math.min(rawRating, 3) as Rating;
  }
  if ((modality === "typed" || modality === "explain") && outcome === "fail") {
    // High-bar modality miss is the strongest forgetting signal.
    return 1;
  }
  return rawRating;
}
