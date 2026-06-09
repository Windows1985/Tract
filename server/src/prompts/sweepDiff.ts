// Free-recall sweep diff: compares a learner's brain-dump against the items
// of a goal region and returns a per-item verdict. One sweep services many
// items — mentioned-correct items each get a sweep pass evidence event.

export const sweepDiffPrompt = (
  goalName: string,
  items: { id: string; statement: string }[],
  dump: string
) => `A learner was asked: "Write everything you know about ${goalName}." Below is their free-recall dump, followed by the knowledge items in that region.

For EACH item decide:
- "mentioned_correct": the dump conveys the item's content correctly (paraphrase counts; exact wording does not matter).
- "mentioned_wrong": the dump addresses the item but gets it wrong.
- "omitted": the dump does not address the item.

Be strict about correctness but generous about phrasing.

LEARNER DUMP:
"""
${dump}
"""

ITEMS:
${items.map((i) => `- id=${i.id}: ${i.statement}`).join("\n")}

Return ONLY JSON: {"verdicts":[{"item_id":string,"verdict":"mentioned_correct"|"mentioned_wrong"|"omitted"}]} with one verdict per item.`;
