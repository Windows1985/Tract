import { describe, expect, it } from "vitest";
import { outcomeToRating } from "../src/memory/MemoryModel.js";

describe("FSRS rating mapping", () => {
  it("maps fail to 1 and partial to 2 at every modality", () => {
    for (const m of ["mcq", "cued", "typed", "explain"] as const) {
      expect(outcomeToRating("fail", m, false)).toBe(1);
      expect(outcomeToRating("fail", m, true)).toBe(1);
      expect(outcomeToRating("partial", m, false)).toBe(2);
      expect(outcomeToRating("partial", m, true)).toBe(2);
    }
  });

  it("maps pass to 3 at recognition/cued regardless of speed", () => {
    expect(outcomeToRating("pass", "mcq", true)).toBe(3);
    expect(outcomeToRating("pass", "cued", true)).toBe(3);
  });

  it("maps pass at typed/explain to 4 only when faster than median", () => {
    expect(outcomeToRating("pass", "typed", false)).toBe(3);
    expect(outcomeToRating("pass", "typed", true)).toBe(4);
    expect(outcomeToRating("pass", "explain", false)).toBe(3);
    expect(outcomeToRating("pass", "explain", true)).toBe(4);
  });
});
