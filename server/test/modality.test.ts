import { beforeEach, describe, expect, it } from "vitest";
import { State } from "ts-fsrs";
import { freshDb } from "./helpers.js";
import { FsrsMemoryModel } from "../src/memory/fsrs.js";
import { V1Scheduler } from "../src/scheduler/v1.js";
import type { MemoryStateRow } from "../src/types.js";

const state = (over: Partial<MemoryStateRow>): MemoryStateRow => ({
  item_id: "x",
  stability: 5,
  difficulty: 5,
  due: new Date().toISOString(),
  state: State.Review,
  reps: 3,
  lapses: 0,
  last_review: new Date(Date.now() - 86_400_000).toISOString(),
  ...over,
});

describe("modality selection from memory state", () => {
  let scheduler: V1Scheduler;
  beforeEach(() => {
    freshDb();
    scheduler = new V1Scheduler(new FsrsMemoryModel());
  });

  it("new items and stability < 2d get recognition", () => {
    expect(scheduler.selectModality(state({ state: State.New, stability: 0 }), "fact", 0, false)).toBe("mcq");
    expect(scheduler.selectModality(state({ stability: 1.5 }), "fact", 0.8, false)).toBe("mcq");
  });

  it("stability 2–21d gets cued recall", () => {
    expect(scheduler.selectModality(state({ stability: 5 }), "fact", 0.85, false)).toBe("cued");
    expect(scheduler.selectModality(state({ stability: 20 }), "fact", 0.85, false)).toBe("cued");
  });

  it("stability > 21d gets typed; concepts get explain", () => {
    expect(scheduler.selectModality(state({ stability: 30 }), "fact", 0.85, false)).toBe("typed");
    expect(scheduler.selectModality(state({ stability: 30 }), "concept", 0.85, false)).toBe("explain");
    expect(scheduler.selectModality(state({ stability: 30 }), "distinction", 0.85, false)).toBe("typed");
  });

  it("very high retrievability promotes to typed even at mid stability", () => {
    expect(scheduler.selectModality(state({ stability: 10 }), "fact", 0.97, false)).toBe("typed");
  });

  it("a previous fail demotes the modality one level", () => {
    expect(scheduler.selectModality(state({ stability: 30 }), "fact", 0.85, true)).toBe("cued");
    expect(scheduler.selectModality(state({ stability: 5 }), "fact", 0.85, true)).toBe("mcq");
    expect(scheduler.selectModality(state({ stability: 1 }), "fact", 0.5, true)).toBe("mcq");
  });
});
