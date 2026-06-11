import { beforeEach, describe, expect, it } from "vitest";
import { freshDb, insertItem, newMemoryState } from "./helpers.js";
import { getDb, setSetting } from "../src/db.js";
import { setAIBackend } from "../src/ai/index.js";
import { MockBackend } from "../src/ai/mock.js";
import {
  getProbe,
  startSession,
  submitAnswer,
  type Session,
} from "../src/session/engine.js";

// ---------------------------------------------------------------------------
// Stub backend that injects a specific grade errorType while delegating
// everything else to MockBackend.
// ---------------------------------------------------------------------------
class GradeStubBackend extends MockBackend {
  constructor(private et: "blank" | "near_miss" | "confident_wrong" | null) {
    super();
  }
  override async grade() {
    return { outcome: "fail" as const, note: "Wrong.", errorType: this.et };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setupTypedItem(): string {
  const id = insertItem({
    statement: "Photosynthesis converts light energy into chemical energy.",
    kind: "fact",
  });
  newMemoryState(id);
  // High stability → selectModality picks typed/explain.
  getDb()
    .prepare(
      "UPDATE memory_states SET stability=40, state=2, last_review=datetime('now','-60 days'), due=datetime('now','-1 days') WHERE item_id=?"
    )
    .run(id);
  return id;
}

async function findTypedProbe(session: Session, itemId: string) {
  const idx = session.plan.queue.findIndex((q) => q.itemId === itemId);
  if (idx === -1) return null;
  const probe = await getProbe(session, idx);
  if (probe.modality !== "typed" && probe.modality !== "explain") return null;
  return { idx, probe };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("error_type persisted on evidence events", () => {
  beforeEach(() => {
    freshDb();
    setSetting("daily_minutes", "60");
  });

  it("writes error_type to the evidence_events row for typed probe fails", async () => {
    setAIBackend(new GradeStubBackend("confident_wrong"));
    const id = setupTypedItem();
    const session = startSession();
    const found = await findTypedProbe(session, id);
    if (!found) return; // item not scheduled as typed — skip

    await submitAnswer(session, found.idx, 5000, { text: "wrong answer" });

    const row = getDb()
      .prepare(
        "SELECT error_type FROM evidence_events WHERE item_id=? AND type='probe' AND outcome='fail'"
      )
      .get(id) as { error_type: string | null } | undefined;
    expect(row).toBeTruthy();
    expect(row!.error_type).toBe("confident_wrong");
  });

  it("writes null error_type for mcq fails (no grading)", async () => {
    setAIBackend(new MockBackend());
    const id = insertItem({ statement: "Water boils at 100 degrees Celsius at standard pressure.", kind: "fact" });
    newMemoryState(id); // new item → MCQ modality
    const session = startSession();
    const idx = session.plan.queue.findIndex((q) => q.itemId === id);
    if (idx === -1) return;
    const probe = await getProbe(session, idx);
    if (probe.modality !== "mcq") return;

    const wrongOpt = (probe.options!.findIndex((_, i) => i !== probe.options!.indexOf(
      (getDb().prepare("SELECT statement FROM items WHERE id=?").get(id) as any).statement
    )));
    await submitAnswer(session, idx, 2000, { optionIndex: wrongOpt });

    const row = getDb()
      .prepare(
        "SELECT error_type FROM evidence_events WHERE item_id=? AND type='probe' AND outcome='fail'"
      )
      .get(id) as { error_type: string | null } | undefined;
    expect(row).toBeTruthy();
    expect(row!.error_type).toBeNull();
  });
});

describe("fail loop-back rules per error_type", () => {
  beforeEach(() => {
    freshDb();
    setSetting("daily_minutes", "60");
  });

  it("confident_wrong: appends TWO re-probes and exhausts retry budget", async () => {
    setAIBackend(new GradeStubBackend("confident_wrong"));
    const id = setupTypedItem();
    const session = startSession();
    const found = await findTypedProbe(session, id);
    if (!found) return;

    const before = session.plan.queue.length;
    await submitAnswer(session, found.idx, 5000, { text: "wrong answer" });

    const retries = session.plan.queue.filter((q) => q.itemId === id && q.isRetry);
    expect(retries.length).toBe(2);
    expect(session.plan.queue.length).toBe(before + 2);
    expect(session.retryCount.get(id)).toBe(2);
    for (const r of retries) expect(r.modality).toBe("mcq");
  });

  it("near_miss: appends exactly ONE re-probe", async () => {
    setAIBackend(new GradeStubBackend("near_miss"));
    const id = setupTypedItem();
    const session = startSession();
    const found = await findTypedProbe(session, id);
    if (!found) return;

    const before = session.plan.queue.length;
    await submitAnswer(session, found.idx, 5000, { text: "partly right" });

    const retries = session.plan.queue.filter((q) => q.itemId === id && q.isRetry);
    expect(retries.length).toBe(1);
    expect(session.plan.queue.length).toBe(before + 1);
    expect(session.retryCount.get(id)).toBe(1);
  });

  it("blank: appends ONE re-probe at mcq modality (two-level demotion)", async () => {
    setAIBackend(new GradeStubBackend("blank"));
    const id = setupTypedItem();
    const session = startSession();
    const found = await findTypedProbe(session, id);
    if (!found) return;

    const before = session.plan.queue.length;
    await submitAnswer(session, found.idx, 5000, { text: "" });

    const retries = session.plan.queue.filter((q) => q.itemId === id && q.isRetry);
    expect(retries.length).toBe(1);
    expect(retries[0].modality).toBe("mcq");
    expect(session.plan.queue.length).toBe(before + 1);
  });

  it("confident_wrong: retry budget exhausted after first fail — no more added", async () => {
    setAIBackend(new GradeStubBackend("confident_wrong"));
    const id = setupTypedItem();
    const session = startSession();
    const found = await findTypedProbe(session, id);
    if (!found) return;

    // First typed fail → 2 retries pushed, retryCount = 2.
    await submitAnswer(session, found.idx, 5000, { text: "wrong answer" });
    expect(session.retryCount.get(id)).toBe(2);
    const afterFirst = session.plan.queue.filter((q) => q.itemId === id && q.isRetry).length;
    expect(afterFirst).toBe(2);

    // Fail the first MCQ retry — budget is exhausted, no new retries.
    setAIBackend(new MockBackend()); // MCQ uses option selection, not grading
    const retryIdx = session.plan.queue.findIndex((q) => q.itemId === id && q.isRetry);
    const retryProbe = await getProbe(session, retryIdx);
    const stmt = (getDb().prepare("SELECT statement FROM items WHERE id=?").get(id) as any).statement as string;
    const wrongOpt = retryProbe.options!.findIndex((o) => o !== stmt);
    await submitAnswer(session, retryIdx, 2000, { optionIndex: wrongOpt });

    // Queue should not grow — budget was 2 and is now still 2.
    const afterSecond = session.plan.queue.filter((q) => q.itemId === id && q.isRetry).length;
    expect(afterSecond).toBe(2); // no new entries
  });
});
