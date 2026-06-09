// Standalone distractor generation — used when an item is added or edited
// after ingest and lacks cached MCQ distractors.

export const distractorsPrompt = (statement: string, kind: string) => `Generate exactly 3 plausible-but-wrong multiple-choice distractors for this ${kind} a learner must remember:

"${statement}"

Each distractor must be the same register and roughly the same length as the true statement, and wrong in a way a half-knowing learner would find tempting (not absurd, not trivially false).

Return ONLY JSON: {"distractors":[string,string,string]}`;
