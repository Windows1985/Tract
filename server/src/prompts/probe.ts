// Probe generation — one template per modality. The scheduled unit is the
// knowledge item; probes are generated fresh at review time so the learner
// never pattern-matches a stored prompt. `avoid` carries the questions used
// for this item in the last 60 days (cached in evidence payloads).

const avoidBlock = (avoid: string[]) =>
  avoid.length
    ? `\nDo NOT reuse or closely paraphrase any of these previously used questions:\n${avoid.map((q) => `- ${q}`).join("\n")}\n`
    : "";

export const recognitionProbePrompt = (statement: string, avoid: string[]) => `Write a fresh multiple-choice question stem that tests recognition of this knowledge item. The question must be answerable by picking the item's statement from a set of options (the options are supplied separately — do not write options). Never quote the statement verbatim in the question.

ITEM: "${statement}"
${avoidBlock(avoid)}
Return ONLY JSON: {"question":string}`;

export const cuedProbePrompt = (statement: string, avoid: string[]) => `Write a fresh cued-recall question for this knowledge item: a short question whose complete answer is the item's content. Never include the statement verbatim or give the answer away. Use LaTeX ($...$) for any maths or chemistry.

ITEM: "${statement}"
${avoidBlock(avoid)}
Return ONLY JSON: {"question":string}`;

export const typedProbePrompt = (statement: string, avoid: string[]) => `Write a fresh question for this knowledge item that requires the learner to type the answer from memory. The full content of the item must be needed to answer correctly. Never include the statement verbatim. Use LaTeX ($...$) for any maths or chemistry.

ITEM: "${statement}"
${avoidBlock(avoid)}
Return ONLY JSON: {"question":string}`;

export const explainProbePrompt = (statement: string, avoid: string[]) => `This concept is being tested at the explanation level. Write a fresh "Explain why/how ___ in 1–2 sentences" style question that requires genuine understanding of the concept, not recitation. Never include the statement verbatim.

CONCEPT: "${statement}"
${avoidBlock(avoid)}
Return ONLY JSON: {"question":string}`;

export const contrastProbePrompt = (
  statement: string,
  contrastStatement: string | null,
  avoid: string[]
) => `This is a distinction item. Write a fresh contrast question of the form "What's the difference between X and Y?" (or an equivalent phrasing) that forces the learner to articulate the distinction. Never include either statement verbatim.

DISTINCTION ITEM: "${statement}"${contrastStatement ? `\nCONTRASTING ITEM: "${contrastStatement}"` : ""}
${avoidBlock(avoid)}
Return ONLY JSON: {"question":string}`;
