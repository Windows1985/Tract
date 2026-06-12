import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, insertItem, newMemoryState } from "./helpers.js";
import { getDb } from "../src/db.js";
import { logEvent } from "../src/evidence.js";
import { replayMemoryStates, loadState } from "../src/memory/store.js";

describe("replayMemoryStates — reads stored payload.rating", () => {
  beforeEach(() => {
    freshDb();
  });

  it("two events with same outcome but different stored ratings produce different states", () => {
    const idA = insertItem({ statement: "Oxidation is loss of electrons." });
    const idB = insertItem({ statement: "Reduction is gain of electrons." });
    newMemoryState(idA);
    newMemoryState(idB);

    // Both items get outcome=pass, but rating 3 vs rating 4.
    logEvent({
      item_id: idA,
      type: "probe",
      modality: "typed",
      payload: { session_id: "s1", question: "Q?", rating: 3 },
      outcome: "pass",
      duration_ms: 5000,
    });
    logEvent({
      item_id: idB,
      type: "probe",
      modality: "typed",
      payload: { session_id: "s1", question: "Q?", rating: 4 },
      outcome: "pass",
      duration_ms: 2000,
    });

    replayMemoryStates();

    const stA = loadState(idA)!;
    const stB = loadState(idB)!;
    // Both should have reps > 0.
    expect(stA.reps).toBeGreaterThan(0);
    expect(stB.reps).toBeGreaterThan(0);
    // Rating 4 (easy-pass) gives higher stability than rating 3 (pass).
    expect(stB.stability).toBeGreaterThan(stA.stability);
  });
});
