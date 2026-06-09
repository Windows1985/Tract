// Grading prompt for typed / explain / contrast responses.

export const gradingPrompt = (
  statement: string,
  question: string,
  answer: string
) => `Grade a learner's typed answer against the canonical knowledge item.

ITEM (canonical): "${statement}"
QUESTION ASKED: "${question}"
LEARNER ANSWER: "${answer}"

Grade:
- "pass": the answer conveys the item's full content correctly (paraphrase is fine).
- "partial": right direction but incomplete or imprecise.
- "fail": wrong, empty, or misses the point.

"note" is ONE short line of feedback (max ~15 words) — what was right or what was missed. Be honest, never falsely encouraging.

Return ONLY JSON: {"outcome":"pass"|"partial"|"fail","note":string}`;
