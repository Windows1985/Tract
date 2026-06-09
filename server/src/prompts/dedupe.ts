// Semantic dedupe at re-ingest: candidate items are compared against the
// nearest existing item statements; duplicates are skipped before insert.

export const dedupePrompt = (
  candidates: string[],
  existing: string[]
) => `A learning system is ingesting new knowledge items. For each CANDIDATE, decide whether it expresses the same knowledge as any EXISTING item (semantic overlap — different wording of the same idea counts as a duplicate; a genuinely new fact, nuance, or angle does not).

CANDIDATES:
${candidates.map((s, i) => `${i}: ${s}`).join("\n")}

EXISTING:
${existing.map((s) => `- ${s}`).join("\n")}

Return ONLY JSON: {"verdicts":[{"index":number,"duplicate":boolean}]} with one verdict per candidate, using the candidate's index.`;
