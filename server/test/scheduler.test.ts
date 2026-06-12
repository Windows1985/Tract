import { beforeEach, describe, expect, it } from "vitest";
import { addEdge, addGoal, daysAhead, freshDb, insertItem, newMemoryState, setMemoryState } from "./helpers.js";
import { FsrsMemoryModel } from "../src/memory/fsrs.js";
import { V1Scheduler } from "../src/scheduler/v1.js";
import { logEvent } from "../src/evidence.js";

describe("queue building", () => {
  let scheduler: V1Scheduler;
  beforeEach(() => {
    freshDb();
    scheduler = new V1Scheduler(new FsrsMemoryModel());
  });

  it("orders due items by ascending retrievability (weakest first)", () => {
    const weak = insertItem({ statement: "Weak item statement here." });
    setMemoryState(weak, { stability: 2, lastReviewDaysAgo: 20, dueDaysAgo: 1 });
    const strong = insertItem({ statement: "Strong item statement here." });
    setMemoryState(strong, { stability: 50, lastReviewDaysAgo: 2, dueDaysAgo: 1 });
    const plan = scheduler.buildSession();
    const ids = plan.queue.map((q) => q.itemId);
    expect(ids.indexOf(weak)).toBeLessThan(ids.indexOf(strong));
  });

  it("appends new items after due items and respects the daily cap of 10", () => {
    const due = insertItem({ statement: "An already-learned due item." });
    setMemoryState(due, { stability: 3, lastReviewDaysAgo: 10, dueDaysAgo: 1 });
    const newIds = Array.from({ length: 14 }, (_, i) => {
      const id = insertItem({ statement: `Brand new item number ${i}.` });
      newMemoryState(id);
      return id;
    });
    const plan = scheduler.buildSession();
    const ids = plan.queue.map((q) => q.itemId);
    expect(ids[0]).toBe(due);
    const includedNew = ids.filter((id) => newIds.includes(id));
    expect(includedNew.length).toBeLessThanOrEqual(10);
    expect(includedNew.length).toBeGreaterThan(0);
  });

  it("excludes items that are not due", () => {
    const notDue = insertItem({ statement: "Future item not due yet." });
    setMemoryState(notDue, { stability: 50, lastReviewDaysAgo: 1, due: daysAhead(30) });
    const plan = scheduler.buildSession();
    expect(plan.queue.find((q) => q.itemId === notDue)).toBeUndefined();
  });

  it("places contrasts_with pairs adjacently (interleaving)", () => {
    // Three unrelated items with retrievability between the pair's, so a pure
    // retrievability sort would separate the pair.
    const a = insertItem({ statement: "Pair item alpha statement.", kind: "distinction" });
    setMemoryState(a, { stability: 2, lastReviewDaysAgo: 30, dueDaysAgo: 1 }); // weakest
    const mids = ["one", "two", "three"].map((n, i) => {
      const id = insertItem({ statement: `Middling item ${n}.` });
      setMemoryState(id, { stability: 5 + i, lastReviewDaysAgo: 10, dueDaysAgo: 1 });
      return id;
    });
    const b = insertItem({ statement: "Pair item beta statement.", kind: "distinction" });
    setMemoryState(b, { stability: 40, lastReviewDaysAgo: 1, dueDaysAgo: 0.5 }); // strongest
    addEdge(a, b, "contrasts_with", 0.9);

    const plan = scheduler.buildSession();
    const ids = plan.queue.map((q) => q.itemId);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    for (const m of mids) expect(ids).toContain(m);
    expect(Math.abs(ids.indexOf(a) - ids.indexOf(b))).toBe(1);
  });

  it("carries a contrast partner on queue entries for distinction items", () => {
    const a = insertItem({ statement: "Mitosis splits one nucleus into two identical nuclei.", kind: "distinction" });
    const b = insertItem({ statement: "Meiosis halves the chromosome count across two divisions.", kind: "distinction" });
    setMemoryState(a, { stability: 3, lastReviewDaysAgo: 10, dueDaysAgo: 1 });
    setMemoryState(b, { stability: 3, lastReviewDaysAgo: 10, dueDaysAgo: 1 });
    addEdge(a, b);
    const plan = scheduler.buildSession();
    const entryA = plan.queue.find((q) => q.itemId === a)!;
    expect(entryA.contrastItemId).toBe(b);
  });
});

describe("goal-conditioned prioritisation", () => {
  let scheduler: V1Scheduler;
  beforeEach(() => {
    freshDb();
    scheduler = new V1Scheduler(new FsrsMemoryModel());
  });

  it("in the final 14 days, items below 3 session-passes jump the queue", () => {
    // Strong item lacking session-passes vs weak item that already has 3.
    const needsPasses = insertItem({ statement: "Needs successive relearning item." });
    setMemoryState(needsPasses, { stability: 60, lastReviewDaysAgo: 1, due: daysAhead(40) }); // not even due
    const hasPasses = insertItem({ statement: "Already proven item statement." });
    setMemoryState(hasPasses, { stability: 2, lastReviewDaysAgo: 15, dueDaysAgo: 1 }); // very weak + due
    addGoal("Exam", daysAhead(7), [needsPasses, hasPasses]);
    for (const sid of ["s1", "s2", "s3"]) {
      logEvent({
        item_id: hasPasses,
        type: "probe",
        modality: "typed",
        payload: { session_id: sid },
        outcome: "pass",
        duration_ms: 1000,
      });
    }
    const plan = scheduler.buildSession();
    const ids = plan.queue.map((q) => q.itemId);
    expect(ids.indexOf(needsPasses)).toBe(0); // prioritised despite being strong/not-due
    expect(ids).toContain(hasPasses); // still due, still reviewed
    expect(ids.indexOf(needsPasses)).toBeLessThan(ids.indexOf(hasPasses));
  });

  it("after the target date, goal items relax to maintenance (retention 0.75)", () => {
    const strongEnough = insertItem({ statement: "Past-goal item with decent retention." });
    setMemoryState(strongEnough, { stability: 30, lastReviewDaysAgo: 5, dueDaysAgo: 1 }); // R well above 0.75 but due
    const sagging = insertItem({ statement: "Past-goal item that sagged badly." });
    setMemoryState(sagging, { stability: 2, lastReviewDaysAgo: 30, dueDaysAgo: 25 }); // R below 0.75
    addGoal("Old exam", daysAhead(-10), [strongEnough, sagging]);
    const plan = scheduler.buildSession();
    const ids = plan.queue.map((q) => q.itemId);
    expect(ids).not.toContain(strongEnough);
    expect(ids).toContain(sagging);
  });
});

describe("sweep selection", () => {
  it("schedules a sweep when a goal has ≥8 reviewed items below 0.92 retrievability", () => {
    freshDb();
    const scheduler = new V1Scheduler(new FsrsMemoryModel());
    const ids = Array.from({ length: 9 }, (_, i) => {
      const id = insertItem({ statement: `Goal region item number ${i} content.` });
      setMemoryState(id, { stability: 2, lastReviewDaysAgo: 10, dueDaysAgo: 1 });
      return id;
    });
    addGoal("Chemistry", daysAhead(30), ids);
    const plan = scheduler.buildSession();
    expect(plan.sweep).not.toBeNull();
    expect(plan.sweep!.goalName).toBe("Chemistry");
    expect(plan.sweep!.itemIds.length).toBeGreaterThanOrEqual(8);
  });

  it("skips the sweep when too few items are weak", () => {
    freshDb();
    const scheduler = new V1Scheduler(new FsrsMemoryModel());
    const ids = Array.from({ length: 9 }, (_, i) => {
      const id = insertItem({ statement: `Strong goal item number ${i}.` });
      setMemoryState(id, { stability: 200, lastReviewDaysAgo: 1, dueDaysAgo: 0.5 });
      return id;
    });
    addGoal("Chemistry", daysAhead(30), ids);
    const plan = scheduler.buildSession();
    expect(plan.sweep).toBeNull();
  });
});

describe("contrast interleaving phases", () => {
  let scheduler: V1Scheduler;
  beforeEach(() => {
    freshDb();
    scheduler = new V1Scheduler(new FsrsMemoryModel());
  });

  function makeContrastPair() {
    // a: very weak (low R, comes first); fillers: mid R; b: strong (high R, comes last).
    // This ensures fillers appear between a and b in the natural sort order.
    const a = insertItem({ statement: "Mitosis splits one nucleus into two identical nuclei.", kind: "distinction" });
    setMemoryState(a, { stability: 1, lastReviewDaysAgo: 30, dueDaysAgo: 1 }); // very low R
    const b = insertItem({ statement: "Meiosis halves the chromosome count across two divisions.", kind: "distinction" });
    setMemoryState(b, { stability: 100, lastReviewDaysAgo: 1, dueDaysAgo: 0.5 }); // high R
    addEdge(a, b, "contrasts_with", 0.9);
    // Filler items with mid-range R (between a and b).
    const fillers = Array.from({ length: 6 }, (_, i) => {
      const id = insertItem({ statement: `Filler item ${i} for spacing test here.` });
      setMemoryState(id, { stability: 5, lastReviewDaysAgo: 5, dueDaysAgo: 1 });
      return id;
    });
    return { a, b, fillers };
  }

  it("places contrast pairs adjacently when both have <3 typed/explain passes", () => {
    const { a, b } = makeContrastPair();
    // No typed/explain pass events: both have 0 passes.
    const plan = scheduler.buildSession();
    const ids = plan.queue.map((q) => q.itemId);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(Math.abs(ids.indexOf(a) - ids.indexOf(b))).toBe(1);
  });

  it("separates contrast pairs by ≥3 items when both have ≥3 typed/explain passes", () => {
    const { a, b } = makeContrastPair();
    // Give both items ≥3 typed/explain passes.
    for (const id of [a, b]) {
      for (const sid of ["s1", "s2", "s3"]) {
        logEvent({
          item_id: id,
          type: "probe",
          modality: "typed",
          payload: { session_id: sid },
          outcome: "pass",
          duration_ms: 1000,
        });
      }
    }
    const plan = scheduler.buildSession();
    const ids = plan.queue.map((q) => q.itemId);
    expect(ids).toContain(a);
    expect(ids).toContain(b);
    expect(Math.abs(ids.indexOf(a) - ids.indexOf(b))).toBeGreaterThanOrEqual(3);
  });
});
