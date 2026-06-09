// Error loop-back: after any fail, a calm corrective explanation of at most
// three sentences, then the item returns near the session's end as a
// recognition-level re-probe.

export const correctivePrompt = (
  statement: string,
  question: string,
  learnerAnswer: string | null
) => `A learner just failed a retrieval probe. Write a corrective explanation of AT MOST 3 sentences: state the correct idea plainly, and if their answer reveals a specific confusion, address exactly that. Calm, concrete, no praise, no filler.

ITEM (canonical): "${statement}"
QUESTION: "${question}"
${learnerAnswer ? `THEIR ANSWER: "${learnerAnswer}"` : "THEY COULD NOT ANSWER."}

Return ONLY JSON: {"explanation":string}`;
