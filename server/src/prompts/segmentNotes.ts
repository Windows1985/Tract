// Pre-processing step: decompose raw notes into atomic propositions before
// item extraction. Each proposition is one declarative sentence expressing
// exactly one fact, concept, or relationship.

export const segmentNotesPrompt = (rawText: string) =>
  `You are a knowledge extraction assistant. Decompose the following notes into atomic propositions — each expressing exactly one fact, concept, or relationship as a single declarative sentence. Return ONLY a JSON array of strings. No preamble, no markdown.

${rawText}`;
