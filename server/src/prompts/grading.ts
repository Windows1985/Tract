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

"errorType" classifies the nature of a failure; use null for pass or partial:
- "blank": learner wrote nothing, "I don't know", or equivalent
- "near_miss": correct core concept but wrong detail, or correct under a different framing
- "confident_wrong": learner stated an incorrect answer as if certain

Return ONLY JSON: {"outcome":"pass"|"partial"|"fail","note":string,"errorType":"blank"|"near_miss"|"confident_wrong"|null}`;
