import type {
  Corrective,
  DedupeResult,
  ExtractionResult,
  GeneratedProbe,
  Grade,
  SweepDiff,
} from "../types.js";

// All AI calls in the app go through this interface. The real implementation
// (AnthropicBackend) renders the templates in /prompts and validates every
// JSON response with Zod (one corrective retry, then a clean error). The
// mock implementation (MockBackend) powers demo mode and the test suite.

export interface AIBackend {
  extract(material: string, images: { data: string; mediaType: string }[]): Promise<ExtractionResult>;
  distractors(statement: string, kind: string): Promise<string[]>;
  dedupe(candidates: string[], existing: string[]): Promise<DedupeResult>;
  probe(
    modality: "mcq" | "cued" | "typed" | "explain" | "contrast",
    statement: string,
    contrastStatement: string | null,
    avoid: string[]
  ): Promise<GeneratedProbe>;
  sweepDiff(goalName: string, items: { id: string; statement: string }[], dump: string): Promise<SweepDiff>;
  grade(statement: string, question: string, answer: string): Promise<Grade>;
  corrective(statement: string, question: string, learnerAnswer: string | null): Promise<Corrective>;
  validateKey(): Promise<void>;
}

export class AIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AIError";
  }
}
