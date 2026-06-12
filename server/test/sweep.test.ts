import { beforeEach, describe, expect, it } from "vitest";
import { addGoal, daysAhead, freshDb, insertItem, setMemoryState } from "./helpers.js";
import { getDb } from "../src/db.js";
import { setAIBackend } from "../src/ai/index.js";
import { MockBackend } from "../src/ai/mock.js";
import { startSession, submitSweep } from "../src/session/engine.js";
import { loadState } from "../src/memory/store.js";

describe("sweep-diff event application", () => {
  beforeEach(() => {
    freshDb();
    setAIBackend(new MockBackend());
  });

  it("logs sweep passes, updates memory, and queues slipped items", async () => {
    const statements = [
      "Oxidation is the loss of electrons from a species.",
      "Reduction is the gain of electrons by a species.",
      "A catalyst lowers activation energy without being consumed.",
      "Equilibrium constants depend only on temperature changes.",
      "Le Chatelier predicts shifts that counteract imposed changes.",
      "Entropy measures the dispersal of energy in a system.",
      "Enthalpy is the heat content at constant pressure conditions.",
      "Activation energy is the minimum energy to start a reaction.",
      "Exothermic reactions release heat to their surroundings overall.",
    ];
    const ids = statements.map((s) => {
      const id = insertItem({ statement: s });
      setMemoryState(id, { stability: 2, lastReviewDaysAgo: 10, dueDaysAgo: 1 });
      return id;
    });
    addGoal("Chemistry", daysAhead(20), ids);

    const session = startSession();
    expect(session.plan.sweep).not.toBeNull();
    const sweepIds = session.plan.sweep!.itemIds;

    const stabilityBefore = new Map(sweepIds.map((id) => [id, loadState(id)!.stability]));

    // Dump covers the first two items correctly, garbles nothing else.
    const dump =
      "Oxidation is when a species loses electrons. Reduction is when a species gains electrons. That's all I remember.";
    const result = await submitSweep(session, dump, 80_000);

    expect(result.total).toBe(sweepIds.length);
    expect(result.covered).toBeGreaterThanOrEqual(2);
    expect(result.slipped.length).toBe(result.total - result.covered);

    const db = getDb();
    const events = db
      .prepare("SELECT * FROM evidence_events WHERE type = 'sweep' AND item_id IS NOT NULL")
      .all() as any[];
    expect(events.length).toBe(sweepIds.length);

    const passes = events.filter((e) => e.outcome === "pass");
    expect(passes.length).toBe(result.covered);
    for (const e of passes) {
      const payload = JSON.parse(e.payload);
      // Sweep passes log rating 3 with a flag.
      expect(payload.rating).toBe(3);
      expect(payload.sweep_pass).toBe(true);
      // One sweep services many items: the memory model updated each one.
      const after = loadState(e.item_id)!;
      expect(after.stability).toBeGreaterThan(stabilityBefore.get(e.item_id)!);
      expect(after.reps).toBeGreaterThan(3);
    }

    // Wrong/omitted items were queued for probing today.
    const queuedIds = new Set(session.plan.queue.map((q) => q.itemId));
    for (const id of sweepIds) {
      const ev = events.find((e) => e.item_id === id)!;
      if (ev.outcome !== "pass") expect(queuedIds.has(id)).toBe(true);
    }

    // The dump itself was logged as a goal-level sweep event.
    const dumpEvent = db
      .prepare("SELECT * FROM evidence_events WHERE type = 'sweep' AND item_id IS NULL")
      .get() as any;
    expect(dumpEvent).toBeTruthy();
    expect(JSON.parse(dumpEvent.payload).dump).toBe(dump);
    expect(dumpEvent.duration_ms).toBe(80_000);
  });

  it("omitted items get 'omitted' outcome with soft stability decay (not a full fail)", async () => {
    const statements = [
      "Oxidation is the loss of electrons from a species.",
      "Reduction is the gain of electrons by a species.",
      "A catalyst lowers activation energy without being consumed.",
      "Equilibrium constants depend only on temperature changes.",
      "Le Chatelier predicts shifts that counteract imposed changes.",
      "Entropy measures the dispersal of energy in a system.",
      "Enthalpy is the heat content at constant pressure conditions.",
      "Activation energy is the minimum energy to start a reaction.",
      "Exothermic reactions release heat to their surroundings overall.",
    ];
    const ids = statements.map((s) => {
      const id = insertItem({ statement: s });
      setMemoryState(id, { stability: 2, lastReviewDaysAgo: 10, dueDaysAgo: 1 });
      return id;
    });
    addGoal("Chemistry", daysAhead(20), ids);

    const stabilityBefore = new Map(ids.map((id) => [id, loadState(id)!.stability]));

    const session = startSession();
    expect(session.plan.sweep).not.toBeNull();
    // Empty dump: MockBackend should mark items as omitted.
    await submitSweep(session, "", 30_000);

    const db = getDb();
    const events = db
      .prepare("SELECT * FROM evidence_events WHERE type = 'sweep' AND item_id IS NOT NULL")
      .all() as any[];
    const omitted = events.filter((e) => e.outcome === "omitted");
    // At least some items should be omitted from an empty dump.
    expect(omitted.length).toBeGreaterThan(0);

    for (const ev of omitted) {
      const sid = ev.item_id as string;
      const before = stabilityBefore.get(sid)!;
      const after = loadState(sid)!;
      // Stability decayed but stayed above 0.
      expect(after.stability).toBeLessThan(before);
      expect(after.stability).toBeGreaterThan(0);
      // Lapses should NOT increase for an omission.
      expect(after.lapses).toBe(0);
    }
  });
});
