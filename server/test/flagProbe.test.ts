import { beforeEach, describe, expect, it, vi } from "vitest";
import { freshDb, insertItem, newMemoryState } from "./helpers.js";
import { getDb, setSetting } from "../src/db.js";
import { setAIBackend } from "../src/ai/index.js";
import { MockBackend } from "../src/ai/mock.js";
import { flagProbe, getProbe, startSession } from "../src/session/engine.js";
import { getFlaggedProbeQuestions } from "../src/evidence.js";

describe("flag_probe — flagged questions excluded from generation", () => {
  beforeEach(() => {
    freshDb();
    setAIBackend(new MockBackend());
    setSetting("daily_minutes", "60");
  });

  it("stores flagged probe question in probe_flags table", async () => {
    const id = insertItem({ statement: "Photosynthesis converts light energy into chemical energy." });
    newMemoryState(id);

    const session = startSession();
    const idx = session.plan.queue.findIndex((q) => q.itemId === id);
    if (idx === -1) return; // item not scheduled
    await getProbe(session, idx);

    const question = session.probes.get(idx)!.question;
    flagProbe(session, idx);

    const flagged = getFlaggedProbeQuestions(id);
    expect(flagged).toContain(question);

    const row = getDb()
      .prepare("SELECT * FROM probe_flags WHERE item_id = ?")
      .get(id) as any;
    expect(row).toBeTruthy();
    expect(row.question).toBe(question);
    expect(row.reason).toBe("bad_probe");
  });

  it("flagged questions appear in the avoid list for the next generation", async () => {
    const id = insertItem({ statement: "Mitosis produces two genetically identical daughter cells." });
    newMemoryState(id);

    // Pre-seed a flagged question directly.
    const flaggedQ = "What is the outcome of mitosis?";
    getDb()
      .prepare("INSERT INTO probe_flags (id, item_id, question, reason, created_at) VALUES (?, ?, ?, ?, ?)")
      .run("flag-1", id, flaggedQ, "bad_probe", new Date().toISOString());

    // Spy on the mock backend's probe method to check the avoid list.
    const backend = new MockBackend();
    const probeSpy = vi.spyOn(backend, "probe");
    setAIBackend(backend);

    const session = startSession();
    const idx = session.plan.queue.findIndex((q) => q.itemId === id);
    if (idx === -1) return;
    await getProbe(session, idx);

    expect(probeSpy).toHaveBeenCalled();
    const avoidArg = probeSpy.mock.calls[0][3] as string[]; // 4th arg is avoid[]
    expect(avoidArg).toContain(flaggedQ);
  });
});
