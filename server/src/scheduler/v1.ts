import { getDb, getDailyMinutes } from "../db.js";
import type { Kind, MemoryStateRow, Modality, QueueEntry, SessionPlan } from "../types.js";
import type { SchedulerPolicy } from "./SchedulerPolicy.js";
import type { MemoryModel } from "../memory/MemoryModel.js";
import { lastProbeOutcome, newItemsIntroducedToday, sessionPassCount, typedExplainPassCount } from "../evidence.js";
import { State } from "ts-fsrs";

const SECONDS_PER_PROBE = 35;
const SWEEP_SECONDS = 90;
const NEW_PER_DAY_BASE = 10;
const NEW_PER_DAY_MAX = 20;
const SWEEP_MIN_WEAK_ITEMS = 8;
const SWEEP_RETRIEVABILITY = 0.92;
const MAINTENANCE_RETENTION = 0.75;
const RELEARN_WINDOW_DAYS = 14;
const RELEARN_REQUIRED_PASSES = 3;

interface Candidate {
  itemId: string;
  kind: Kind;
  state: MemoryStateRow;
  retrievability: number;
  isNew: boolean;
  relearnPriority: boolean; // goal in final 14 days and < 3 session-passes
}

export class V1Scheduler implements SchedulerPolicy {
  constructor(private memory: MemoryModel) {}

  selectModality(
    state: MemoryStateRow,
    kind: Kind,
    retrievability: number,
    lastOutcomeWasFail: boolean
  ): Modality {
    // Base level from memory state:
    //   stability < 2 days            -> recognition (mcq)
    //   2–21 days                     -> cued recall
    //   > 21 days or R > 0.95         -> typed recall / explain
    let level: 0 | 1 | 2;
    if (state.state === State.New || state.stability < 2) level = 0;
    else if (state.stability > 21 || retrievability > 0.95) level = 2;
    else level = 1;
    // A fail demotes next-time modality one level; pass at typed/explain is
    // the only path to long intervals.
    if (lastOutcomeWasFail && level > 0) level = (level - 1) as 0 | 1;
    if (level === 0) return "mcq";
    if (level === 1) return "cued";
    return kind === "concept" ? "explain" : "typed"; // distinctions get contrast-styled typed probes
  }

  buildSession(now: Date = new Date()): SessionPlan {
    const db = getDb();
    const minutes = getDailyMinutes();

    const items = db
      .prepare(
        `SELECT i.id, i.kind, m.item_id, m.stability, m.difficulty, m.due, m.state, m.reps, m.lapses, m.last_review
         FROM items i JOIN memory_states m ON m.item_id = i.id
         WHERE i.archived = 0`
      )
      .all() as (MemoryStateRow & { id: string; kind: Kind })[];

    const goals = db.prepare("SELECT * FROM goals").all() as {
      id: string;
      name: string;
      target_date: string | null;
    }[];
    const goalItems = db.prepare("SELECT goal_id, item_id FROM goal_items").all() as {
      goal_id: string;
      item_id: string;
    }[];
    const itemGoals = new Map<string, string[]>();
    for (const gi of goalItems) {
      const arr = itemGoals.get(gi.item_id) ?? [];
      arr.push(gi.goal_id);
      itemGoals.set(gi.item_id, arr);
    }
    const goalById = new Map(goals.map((g) => [g.id, g]));

    const candidates: Candidate[] = [];
    for (const row of items) {
      const state: MemoryStateRow = row;
      const r = this.memory.retrievability(state, now);
      const isNew = state.state === State.New;
      const due = new Date(state.due).getTime() <= now.getTime();

      // Goal conditioning per item.
      const gids = itemGoals.get(row.id) ?? [];
      let maintenanceOnly = gids.length > 0;
      let relearnPriority = false;
      for (const gid of gids) {
        const g = goalById.get(gid);
        if (!g) continue;
        const target = g.target_date ? new Date(g.target_date).getTime() : null;
        const daysToTarget = target === null ? null : (target - now.getTime()) / 86_400_000;
        if (daysToTarget === null || daysToTarget > 0) maintenanceOnly = false; // some goal still live
        if (daysToTarget !== null && daysToTarget >= 0 && daysToTarget <= RELEARN_WINDOW_DAYS) {
          // Successive-relearning mode: each item must pass in ≥3 separate
          // sessions before the date; prioritise items below that bar.
          if (sessionPassCount(row.id) < RELEARN_REQUIRED_PASSES) relearnPriority = true;
        }
      }

      if (maintenanceOnly && !isNew) {
        // All of this item's goals are past their target date: relax to
        // maintenance — only review when retrievability sags below 0.75.
        if (r >= MAINTENANCE_RETENTION) continue;
      } else if (!isNew && !due && !relearnPriority) {
        continue;
      }

      candidates.push({ itemId: row.id, kind: row.kind, state, retrievability: r, isNew, relearnPriority });
    }

    // Order: relearn-priority items first, then due items, both ascending
    // retrievability (weakest first); then new items, capped per day.
    const relearn = candidates.filter((c) => c.relearnPriority && !c.isNew);
    const due = candidates.filter((c) => !c.relearnPriority && !c.isNew);
    const fresh = candidates.filter((c) => c.isNew);
    const byR = (a: Candidate, b: Candidate) => a.retrievability - b.retrievability;
    relearn.sort(byR);
    due.sort(byR);
    fresh.sort((a, b) => a.state.due.localeCompare(b.state.due));

    const newBudget = Math.max(0, this.goalAwareNewCap(goals, goalItems, now) - newItemsIntroducedToday());

    // Sweep decision: any goal with ≥8 items below 0.92 retrievability →
    // sweep the most at-risk goal region.
    const sweep = this.pickSweep(goals, goalItems, items, now);

    const budgetSeconds = minutes * 60 - (sweep ? SWEEP_SECONDS : 0);
    const capacity = Math.max(3, Math.floor(budgetSeconds / SECONDS_PER_PROBE));

    let ordered = [...relearn, ...due];
    if (ordered.length < capacity) ordered = [...ordered, ...fresh.slice(0, Math.min(newBudget, capacity - ordered.length))];
    ordered = ordered.slice(0, capacity);

    const queue = this.interleaveContrasts(ordered);
    return { sweep, queue, minutes };
  }

  /**
   * Items sharing a contrasts_with edge are placed adjacently so confusable
   * pairs are retrieved back-to-back (interleaving effect).
   */
  private interleaveContrasts(ordered: Candidate[]): QueueEntry[] {
    const db = getDb();
    const ids = new Set(ordered.map((c) => c.itemId));
    const contrastsOf = new Map<string, string[]>();
    const edges = db
      .prepare("SELECT item_a, item_b FROM edges WHERE relation = 'contrasts_with'")
      .all() as { item_a: string; item_b: string }[];
    for (const e of edges) {
      if (ids.has(e.item_a) && ids.has(e.item_b)) {
        contrastsOf.set(e.item_a, [...(contrastsOf.get(e.item_a) ?? []), e.item_b]);
        contrastsOf.set(e.item_b, [...(contrastsOf.get(e.item_b) ?? []), e.item_a]);
      }
    }
    // Any contrast partner (in or out of queue) for distinction probes:
    const anyContrast = new Map<string, string>();
    const allEdges = db
      .prepare("SELECT item_a, item_b FROM edges WHERE relation = 'contrasts_with'")
      .all() as { item_a: string; item_b: string }[];
    for (const e of allEdges) {
      if (!anyContrast.has(e.item_a)) anyContrast.set(e.item_a, e.item_b);
      if (!anyContrast.has(e.item_b)) anyContrast.set(e.item_b, e.item_a);
    }

    const byId = new Map(ordered.map((c) => [c.itemId, c]));
    const placed = new Set<string>();
    const result: QueueEntry[] = [];
    const push = (c: Candidate) => {
      placed.add(c.itemId);
      result.push({
        itemId: c.itemId,
        modality: this.selectModality(
          c.state,
          c.kind,
          c.retrievability,
          lastProbeOutcome(c.itemId) === "fail"
        ),
        isRetry: false,
        contrastItemId: anyContrast.get(c.itemId),
      });
    };
    // Track which pairs should be separated (≥3 typed/explain passes each).
    const shouldSeparate = (a: string, b: string) =>
      typedExplainPassCount(a) >= 3 && typedExplainPassCount(b) >= 3;

    for (const c of ordered) {
      if (placed.has(c.itemId)) continue;
      push(c);
      for (const partnerId of contrastsOf.get(c.itemId) ?? []) {
        const partner = byId.get(partnerId);
        if (!partner || placed.has(partnerId)) continue;
        if (!shouldSeparate(c.itemId, partnerId)) push(partner);
        // Separated pairs: let partner be placed later by the main loop (no adjacency).
      }
    }

    // Post-process: for pairs that should be separated but ended up <4 apart,
    // move the second occurrence to position (first + 4).
    for (const c of ordered) {
      for (const partnerId of contrastsOf.get(c.itemId) ?? []) {
        if (!shouldSeparate(c.itemId, partnerId)) continue;
        const posA = result.findIndex((e) => e.itemId === c.itemId);
        const posB = result.findIndex((e) => e.itemId === partnerId);
        if (posA === -1 || posB === -1) continue;
        const gap = Math.abs(posA - posB);
        if (gap < 4) {
          // Remove the later-appearing item and reinsert ≥4 after the earlier.
          const [earlier, later] = posA < posB ? [posA, posB] : [posB, posA];
          const [removed] = result.splice(later, 1);
          const target = Math.min(result.length, earlier + 4);
          result.splice(target, 0, removed);
        }
      }
    }
    return result;
  }

  /**
   * Goal-aware new-item cap: base 10/day, ×3 if any goal is in the final 14
   * days (successive-relearning mode) to front-load new material before the
   * deadline. Hard cap at 20/day.
   */
  private goalAwareNewCap(
    goals: { id: string; target_date: string | null }[],
    goalItems: { goal_id: string; item_id: string }[],
    now: Date
  ): number {
    let factor = 1;
    for (const g of goals) {
      if (!g.target_date) continue;
      const daysToTarget = (new Date(g.target_date).getTime() - now.getTime()) / 86_400_000;
      if (daysToTarget >= 0 && daysToTarget <= RELEARN_WINDOW_DAYS) {
        factor = 3;
        break;
      }
    }
    // Suppress unused-variable lint for goalItems (kept for future per-goal calc).
    void goalItems;
    return Math.min(NEW_PER_DAY_MAX, NEW_PER_DAY_BASE * factor);
  }

  private pickSweep(
    goals: { id: string; name: string; target_date: string | null }[],
    goalItems: { goal_id: string; item_id: string }[],
    items: (MemoryStateRow & { id: string; kind: Kind })[],
    now: Date
  ) {
    const stateById = new Map(items.map((i) => [i.id, i as MemoryStateRow]));
    let best: { goalId: string; goalName: string; itemIds: string[]; meanR: number } | null = null;
    for (const g of goals) {
      const ids = goalItems.filter((gi) => gi.goal_id === g.id).map((gi) => gi.item_id);
      const weak: { id: string; r: number }[] = [];
      let sum = 0;
      let n = 0;
      for (const id of ids) {
        const st = stateById.get(id);
        if (!st) continue;
        const r = this.memory.retrievability(st, now);
        // New items haven't been learned yet; a sweep can't service them.
        if (st.state === State.New) continue;
        n++;
        sum += r;
        if (r < SWEEP_RETRIEVABILITY) weak.push({ id, r });
      }
      if (weak.length >= SWEEP_MIN_WEAK_ITEMS) {
        const meanR = n ? sum / n : 1;
        if (!best || meanR < best.meanR) {
          weak.sort((a, b) => a.r - b.r);
          best = { goalId: g.id, goalName: g.name, itemIds: weak.slice(0, 20).map((w) => w.id), meanR };
        }
      }
    }
    return best ? { goalId: best.goalId, goalName: best.goalName, itemIds: best.itemIds } : null;
  }
}
