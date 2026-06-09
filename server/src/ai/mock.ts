import type { AIBackend } from "./backend.js";
import type { ExtractionResult, Kind } from "../types.js";

// Deterministic mocked AI layer. Powers demo mode (the app is fully usable
// without an API key, clearly labelled) and the end-to-end test suite. The
// heuristics are crude on purpose — the point is exercising the full loop,
// not intelligence.

const STOPWORDS = new Set(
  "the a an of to in and or is are was were be been it its this that with for on as by from at not no which what when how why".split(" ")
);

function keywords(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function overlap(a: string, b: string): number {
  const ka = new Set(keywords(a));
  const kb = keywords(b);
  if (kb.length === 0) return 0;
  let hit = 0;
  for (const w of kb) if (ka.has(w)) hit++;
  return hit / kb.length;
}

export class MockBackend implements AIBackend {
  async validateKey(): Promise<void> {
    /* demo mode never fails validation */
  }

  async extract(material: string): Promise<ExtractionResult> {
    // Split into sentences / lines; take the most substantial ones as items.
    const raw = material
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim().replace(/^[-*•\d.)\s]+/, ""))
      .filter((s) => s.length >= 20);
    const seen = new Set<string>();
    const sentences = raw.filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const capped = sentences.slice(0, 30);
    const items = capped.map((statement) => {
      const lower = statement.toLowerCase();
      const kind: Kind = /\bdiffer|versus|vs\.?|whereas|unlike\b/.test(lower)
        ? "distinction"
        : /\bstep|first|then|process|procedure\b/.test(lower)
          ? "procedure"
          : /\bbecause|means|principle|states that|is when\b/.test(lower)
            ? "concept"
            : "fact";
      return {
        statement: statement.endsWith(".") ? statement : statement + ".",
        kind,
        distractors: makeDistractors(statement),
      };
    });
    // Edges: adjacent items related; pairs sharing 3+ keywords contrast.
    const edges: ExtractionResult["edges"] = [];
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const shared = keywords(items[i].statement).filter((w) =>
          new Set(keywords(items[j].statement)).has(w)
        ).length;
        if (shared >= 3) edges.push({ a: i, b: j, relation: "contrasts_with", weight: 0.8 });
        else if (j === i + 1) edges.push({ a: i, b: j, relation: "related_to", weight: 0.4 });
      }
    }
    if (items.length === 0) {
      items.push({
        statement: "This material was too short to extract items from; this is a demo placeholder item.",
        kind: "fact",
        distractors: makeDistractors("demo placeholder"),
      });
    }
    return { items, edges, richer: sentences.length > 30 };
  }

  async distractors(statement: string): Promise<string[]> {
    return makeDistractors(statement);
  }

  async dedupe(candidates: string[], existing: string[]) {
    const norm = (s: string) => keywords(s).sort().join(" ");
    const existingNorm = new Set(existing.map(norm));
    return {
      verdicts: candidates.map((c, index) => ({
        index,
        duplicate: existingNorm.has(norm(c)) || existing.some((e) => overlap(e, c) > 0.85 && overlap(c, e) > 0.85),
      })),
    };
  }

  async probe(
    modality: "mcq" | "cued" | "typed" | "explain" | "contrast",
    statement: string,
    contrastStatement: string | null
  ) {
    const topic = keywords(statement).slice(0, 3).join(" ") || "this idea";
    switch (modality) {
      case "mcq":
        return { question: `Which of the following is true about ${topic}?` };
      case "cued":
        return { question: `From memory: what do you know about ${topic}?` };
      case "typed":
        return { question: `Type, from memory, the key point about ${topic}.` };
      case "explain":
        return { question: `Explain, in 1–2 sentences, the idea behind ${topic}.` };
      case "contrast":
        return {
          question: contrastStatement
            ? `What's the difference between ${topic} and ${keywords(contrastStatement).slice(0, 3).join(" ")}?`
            : `What is ${topic} commonly confused with, and how do they differ?`,
        };
    }
  }

  async sweepDiff(_goalName: string, items: { id: string; statement: string }[], dump: string) {
    return {
      verdicts: items.map((i) => {
        const score = overlap(dump, i.statement);
        return {
          item_id: i.id,
          verdict:
            score >= 0.5
              ? ("mentioned_correct" as const)
              : score >= 0.25
                ? ("mentioned_wrong" as const)
                : ("omitted" as const),
        };
      }),
    };
  }

  async grade(statement: string, _question: string, answer: string) {
    const score = overlap(statement, answer);
    if (score >= 0.5) return { outcome: "pass" as const, note: "Covers the key point." };
    if (score >= 0.25) return { outcome: "partial" as const, note: "Right direction, missing detail." };
    return { outcome: "fail" as const, note: "That misses the core idea." };
  }

  async corrective(statement: string) {
    return { explanation: `The key point: ${statement}` };
  }
}

function makeDistractors(statement: string): string[] {
  const negated = statement.replace(/\b(is|are|was|were)\b/i, (m) => m + " not");
  return [
    negated !== statement ? negated : `It is widely believed that ${statement.toLowerCase()} — but reversed.`,
    `The opposite of the true statement: ${keywords(statement).slice(0, 4).join(" ")} works the other way around.`,
    `A common misconception that sounds like, but is not, the correct statement about ${keywords(statement).slice(0, 3).join(" ") || "this"}.`,
  ];
}
