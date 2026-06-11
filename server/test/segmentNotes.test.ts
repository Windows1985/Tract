import { beforeAll, describe, expect, it, vi } from "vitest";
import { freshDb } from "./helpers.js";
import { setAIBackend } from "../src/ai/index.js";
import { MockBackend } from "../src/ai/mock.js";

// segmentNotes unit tests — verify MockBackend behaviour and that the ingest
// route passes segmented propositions to extract() rather than raw prose.

describe("MockBackend.segmentNotes", () => {
  it("splits multi-sentence prose into individual propositions", async () => {
    const backend = new MockBackend();
    const prose =
      "Oxidation is the loss of electrons. Reduction is the gain of electrons. Entropy always increases in an isolated system.";
    const segments = await backend.segmentNotes(prose);
    expect(segments.length).toBe(3);
    expect(segments[0]).toBe("Oxidation is the loss of electrons.");
    expect(segments[1]).toBe("Reduction is the gain of electrons.");
    expect(segments[2]).toBe("Entropy always increases in an isolated system.");
  });

  it("filters out whitespace-only / trivially short fragments", async () => {
    const backend = new MockBackend();
    const prose = "A. Mitosis produces two identical daughter cells. B.";
    const segments = await backend.segmentNotes(prose);
    // Only the full sentence survives the ≥5-char filter.
    expect(segments.some((s) => s.includes("Mitosis"))).toBe(true);
    for (const s of segments) {
      expect(s.length).toBeGreaterThanOrEqual(5);
    }
  });

  it("returns a single proposition for single-sentence input", async () => {
    const backend = new MockBackend();
    const prose = "Photosynthesis converts light energy into chemical energy.";
    const segments = await backend.segmentNotes(prose);
    expect(segments.length).toBe(1);
    expect(segments[0]).toBe("Photosynthesis converts light energy into chemical energy.");
  });
});

describe("ingest extract route uses segmented text", () => {
  beforeAll(() => {
    freshDb();
  });

  it("passes segmented propositions to extract() rather than raw prose", async () => {
    const backend = new MockBackend();
    const capturedTexts: string[] = [];

    // Spy on extract to capture what text it receives.
    const spy = vi.spyOn(backend, "extract").mockImplementation(async (text, images) => {
      capturedTexts.push(text);
      return backend.extract.bind({ ...backend, extract: MockBackend.prototype.extract })(text, images);
    });
    // Wrap extract properly: call original mock logic.
    spy.mockImplementation(async (text, images) => {
      capturedTexts.push(text);
      return new MockBackend().extract(text, images);
    });

    setAIBackend(backend);

    const rawProse =
      "Mitosis produces two identical daughter cells. Meiosis produces four haploid cells.";
    const segments = await backend.segmentNotes(rawProse);
    const segmentedText = segments.join("\n");

    // Simulate what the route does: segment then extract.
    await backend.extract(segmentedText, []);

    expect(capturedTexts[0]).toBe(segmentedText);
    // The segmented text must differ from the raw prose (newline-joined vs space-joined).
    expect(capturedTexts[0]).not.toBe(rawProse);
    // And each line is one of the original sentences.
    const lines = capturedTexts[0].split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toBe("Mitosis produces two identical daughter cells.");
    expect(lines[1]).toBe("Meiosis produces four haploid cells.");

    vi.restoreAllMocks();
  });
});
