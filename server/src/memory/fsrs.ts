import { createEmptyCard, fsrs, generatorParameters, Rating as FsrsRating, State, type Card } from "ts-fsrs";
import type { MemoryStateRow } from "../types.js";
import type { MemoryModel, Rating } from "./MemoryModel.js";
import { getSetting } from "../db.js";

/**
 * FsrsMemoryModel — MemoryModel v1.
 *
 * ts-fsrs applied per knowledge item (not per card — there are no cards in
 * Tract; probes are generated fresh and the scheduled unit is the item).
 * This is the swappable Newtonian approximation described in MemoryModel.ts.
 */
export class FsrsMemoryModel implements MemoryModel {
  private engine;

  constructor(requestRetention = 0.9) {
    let params = generatorParameters({ request_retention: requestRetention, enable_fuzz: true });
    try {
      const stored = getSetting("fsrs_params");
      if (stored) params = generatorParameters({ ...params, ...JSON.parse(stored) });
    } catch {
      /* settings table may not exist yet in some test setups */
    }
    this.engine = fsrs(params);
  }

  initState(itemId: string, now: Date = new Date()): MemoryStateRow {
    const card = createEmptyCard(now);
    return cardToRow(itemId, card);
  }

  review(state: MemoryStateRow, rating: Rating, now: Date = new Date()): MemoryStateRow {
    const card = rowToCard(state, now);
    const fsrsRating = [FsrsRating.Again, FsrsRating.Hard, FsrsRating.Good, FsrsRating.Easy][rating - 1];
    const record = this.engine.repeat(card, now) as Record<number, { card: Card }>;
    return cardToRow(state.item_id, record[fsrsRating].card);
  }

  retrievability(state: MemoryStateRow, at: Date = new Date()): number {
    if (state.state === State.New || !state.last_review || state.stability <= 0) return 0;
    const elapsedDays = Math.max(0, (at.getTime() - new Date(state.last_review).getTime()) / 86_400_000);
    return forgettingCurve(elapsedDays, state.stability);
  }

  applyStabilityBonus(state: MemoryStateRow, fraction: number): MemoryStateRow {
    const f = Math.min(Math.max(fraction, 0), 0.1); // hard cap: ≤10% of a normal update's effect
    return { ...state, stability: state.stability * (1 + f) };
  }
}

/** FSRS-5 power forgetting curve: R(t) = (1 + FACTOR · t/S)^DECAY */
const DECAY = -0.5;
const FACTOR = 19 / 81;
export function forgettingCurve(elapsedDays: number, stability: number): number {
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

function cardToRow(itemId: string, card: Card): MemoryStateRow {
  return {
    item_id: itemId,
    stability: card.stability,
    difficulty: card.difficulty,
    due: new Date(card.due).toISOString(),
    state: card.state,
    reps: card.reps,
    lapses: card.lapses,
    last_review: card.last_review ? new Date(card.last_review).toISOString() : null,
  };
}

function rowToCard(row: MemoryStateRow, now: Date): Card {
  const card = createEmptyCard(now);
  card.stability = row.stability;
  card.difficulty = row.difficulty;
  card.due = new Date(row.due);
  card.state = row.state as State;
  card.reps = row.reps;
  card.lapses = row.lapses;
  card.last_review = row.last_review ? new Date(row.last_review) : undefined;
  card.elapsed_days = row.last_review
    ? Math.max(0, Math.round((now.getTime() - new Date(row.last_review).getTime()) / 86_400_000))
    : 0;
  card.scheduled_days = row.last_review
    ? Math.max(0, Math.round((new Date(row.due).getTime() - new Date(row.last_review).getTime()) / 86_400_000))
    : 0;
  return card;
}
