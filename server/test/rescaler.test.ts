import { describe, expect, it } from "vitest";
import { rescaleRating } from "../src/memory/MemoryModel.js";

describe("rescaleRating — per-modality FSRS adjustment", () => {
  // free_recall -------------------------------------------------------------------
  it("free_recall pass (rating 3) stays 3", () => {
    expect(rescaleRating(3, "free_recall", "pass")).toBe(3);
  });

  it("free_recall partial (rating 2) stays 2", () => {
    expect(rescaleRating(2, "free_recall", "partial")).toBe(2);
  });

  it("free_recall fail (rating 1) stays 1", () => {
    expect(rescaleRating(1, "free_recall", "fail")).toBe(1);
  });

  it("free_recall hypothetical rating-4 is capped at 3", () => {
    // Ensures the cap logic works if a future code path were to produce rating 4.
    expect(rescaleRating(4 as any, "free_recall", "pass")).toBe(3);
  });

  // typed -------------------------------------------------------------------------
  it("typed fail stays 1", () => {
    expect(rescaleRating(1, "typed", "fail")).toBe(1);
  });

  it("typed pass slow (rating 3) passes through", () => {
    expect(rescaleRating(3, "typed", "pass")).toBe(3);
  });

  it("typed pass fast (rating 4) passes through", () => {
    expect(rescaleRating(4, "typed", "pass")).toBe(4);
  });

  it("typed partial (rating 2) passes through", () => {
    expect(rescaleRating(2, "typed", "partial")).toBe(2);
  });

  // explain -----------------------------------------------------------------------
  it("explain fail stays 1", () => {
    expect(rescaleRating(1, "explain", "fail")).toBe(1);
  });

  it("explain pass fast (rating 4) passes through", () => {
    expect(rescaleRating(4, "explain", "pass")).toBe(4);
  });

  // mcq ---------------------------------------------------------------------------
  it("mcq pass (rating 3) passes through", () => {
    expect(rescaleRating(3, "mcq", "pass")).toBe(3);
  });

  it("mcq partial (rating 2) passes through", () => {
    expect(rescaleRating(2, "mcq", "partial")).toBe(2);
  });

  it("mcq fail (rating 1) passes through", () => {
    expect(rescaleRating(1, "mcq", "fail")).toBe(1);
  });

  // cued --------------------------------------------------------------------------
  it("cued pass (rating 3) passes through", () => {
    expect(rescaleRating(3, "cued", "pass")).toBe(3);
  });

  it("cued partial (rating 2) passes through", () => {
    expect(rescaleRating(2, "cued", "partial")).toBe(2);
  });

  it("cued fail (rating 1) passes through", () => {
    expect(rescaleRating(1, "cued", "fail")).toBe(1);
  });
});
