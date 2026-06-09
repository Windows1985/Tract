// Extraction prompt: turns raw learner material into atomic knowledge items
// plus a small relation graph. Fewer, sharper items beat exhaustive coverage.

export const ingestionPrompt = (material: string, hasImage: boolean) => `You are the ingestion engine of a learning system. Extract the knowledge worth remembering from the learner's material${hasImage ? " (an image of the material is attached — read it carefully)" : ""}.

Rules:
- Each item is ONE atomic idea, stated as a single declarative sentence in canonical form (e.g. "Le Chatelier's principle states that a system at equilibrium shifts to counteract an imposed change."). Never a question.
- kind is one of: "fact" (a discrete fact), "concept" (an idea that can be explained), "distinction" (a contrast between two confusable things), "procedure" (a sequence of steps, stated compactly).
- Prefer fewer, sharper items over exhaustive coverage. Cap at 30 items. If the material clearly contained more item-worthy content than 30, set "richer": true, otherwise false.
- For each item produce exactly 3 plausible-but-wrong MCQ distractors: same register and length as the true statement, wrong in a way a half-knowing learner would find tempting.
- Edges connect items by index: "contrasts_with" for confusable pairs (be generous here — these power contrast probes), "depends_on" when understanding one requires the other, "related_to" otherwise. weight is 0–1 strength.

Return ONLY JSON, no prose, matching:
{"items":[{"statement":string,"kind":"fact"|"concept"|"distinction"|"procedure","distractors":[string,string,string]}],"edges":[{"a":number,"b":number,"relation":"contrasts_with"|"depends_on"|"related_to","weight":number}],"richer":boolean}

MATERIAL:
${material}`;
