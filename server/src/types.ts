import { z } from "zod";

// ---------------------------------------------------------------------------
// Core domain types and the Zod schemas used at every API boundary and on
// every AI JSON response. The evidence-event log is the source of truth; all
// of these types either feed it or are derived from it.
// ---------------------------------------------------------------------------

export const KindSchema = z.enum(["fact", "concept", "distinction", "procedure"]);
export type Kind = z.infer<typeof KindSchema>;

export const ModalitySchema = z.enum(["mcq", "cued", "typed", "free_recall", "explain"]);
export type Modality = z.infer<typeof ModalitySchema>;

export const OutcomeSchema = z.enum(["pass", "partial", "fail"]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const EventTypeSchema = z.enum(["probe", "sweep", "correction", "calibration"]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const RelationSchema = z.enum(["contrasts_with", "depends_on", "related_to"]);
export type Relation = z.infer<typeof RelationSchema>;

export interface Item {
  id: string;
  statement: string;
  kind: Kind;
  source_text: string | null;
  distractors: string[]; // 3 cached MCQ distractors, generated at ingest
  created_at: string;
  archived: boolean;
}

export interface Edge {
  item_a: string;
  item_b: string;
  relation: Relation;
  weight: number;
}

export interface Goal {
  id: string;
  name: string;
  target_date: string | null;
  created_at: string;
}

// Persisted FSRS state — owned by the MemoryModel module.
export interface MemoryStateRow {
  item_id: string;
  stability: number;
  difficulty: number;
  due: string; // ISO
  state: number; // ts-fsrs State enum value
  reps: number;
  lapses: number;
  last_review: string | null;
}

export interface EvidenceEvent {
  id: string;
  item_id: string | null;
  type: EventType;
  modality: Modality | null;
  payload: unknown;
  outcome: Outcome | null;
  duration_ms: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// AI response schemas (every AI JSON response is validated against one of these)
// ---------------------------------------------------------------------------

export const ExtractedItemSchema = z.object({
  statement: z.string().min(3),
  kind: KindSchema,
  topic: z.string().default(""), // short subtopic label, e.g. "Redox"
  distractors: z.array(z.string()).length(3),
});

export const ExtractionResultSchema = z.object({
  items: z.array(ExtractedItemSchema).max(30),
  edges: z.array(
    z.object({
      a: z.number().int().nonnegative(), // indices into items
      b: z.number().int().nonnegative(),
      relation: RelationSchema,
      weight: z.number().min(0).max(1),
    })
  ),
  richer: z.boolean(), // true if the material contained more than the cap
});
export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export const DistractorsSchema = z.object({
  distractors: z.array(z.string()).length(3),
});

export const DedupeResultSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      duplicate: z.boolean(),
    })
  ),
});
export type DedupeResult = z.infer<typeof DedupeResultSchema>;

export const GeneratedProbeSchema = z.object({
  question: z.string().min(3),
});
export type GeneratedProbe = z.infer<typeof GeneratedProbeSchema>;

export const SweepDiffSchema = z.object({
  verdicts: z.array(
    z.object({
      item_id: z.string(),
      verdict: z.enum(["mentioned_correct", "mentioned_wrong", "omitted"]),
    })
  ),
});
export type SweepDiff = z.infer<typeof SweepDiffSchema>;

export const GradeSchema = z.object({
  outcome: OutcomeSchema,
  note: z.string(),
});
export type Grade = z.infer<typeof GradeSchema>;

/** Array of atomic propositions produced by the segmentNotes pre-processing step. */
export const SegmentedNotesSchema = z.array(z.string().min(5).max(300));

export const CorrectiveSchema = z.object({
  explanation: z.string().min(3),
});
export type Corrective = z.infer<typeof CorrectiveSchema>;

// ---------------------------------------------------------------------------
// Session plan types (produced by the SchedulerPolicy)
// ---------------------------------------------------------------------------

export interface QueueEntry {
  itemId: string;
  modality: Modality;
  /** set when this entry is the recognition-level re-probe of a failed item */
  isRetry: boolean;
  /** for distinction contrast probes: the contrasting item, if any */
  contrastItemId?: string;
}

export interface SessionPlan {
  sweep: { goalId: string; goalName: string; itemIds: string[] } | null;
  queue: QueueEntry[];
  minutes: number;
}
