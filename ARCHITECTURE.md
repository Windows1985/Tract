# Tract — Architecture

Tract is a local-first learning system. It schedules **knowledge, not prompts**:
the unit of scheduling is a knowledge *item* (a fact, concept, distinction, or
procedure), never a stored question. Retrieval probes are generated fresh by
the AI at review time, so the learner can never pattern-match a prompt.

```
┌──────────┐   ingest    ┌────────────┐
│  client   │ ─────────▶ │  AI layer  │  (one service, Zod-validated JSON,
│ (React)   │            └─────┬──────┘   one corrective retry)
└────┬─────┘                   │ items + edges + probes + verdicts
     │ session API             ▼
┌────┴──────────────────────────────────────┐
│ server (Express, :5174)                    │
│                                            │
│  SchedulerPolicy ──┐                       │
│       ▲            │ composes sessions     │
│       │ reads      ▼                       │
│  ┌────┴─────────────────────┐              │
│  │   evidence_events (log)  │ ◀── append-only, source of truth
│  └────┬─────────────────────┘              │
│       │ consumed by                        │
│       ▼                                    │
│  MemoryModel (FSRS v1) ──▶ memory_states   │
└────────────────────────────────────────────┘
            SQLite at ./data/tract.db
```

## The evidence-event log is the source of truth

Every observation about the learner's knowledge — a probe answered, a
free-recall sweep verdict, a corrective shown, a calibration guess — is
appended to **one table, `evidence_events`, in one format**:

```
id, item_id (nullable for sweep/calibration-level events),
type   ∈ {probe, sweep, correction, calibration},
modality ∈ {mcq, cued, typed, free_recall, explain},
payload (JSON: the generated probe, the answer, the AI verdict, session_id, rating…),
outcome ∈ {pass, partial, fail} | null,
duration_ms, created_at
```

Everything else is derived. `memory_states` is a *cache of beliefs* owned by
the MemoryModel; you could delete it and rebuild it by replaying the log. The
export/import feature dumps the log itself, so a restore reproduces the
learner exactly. Generated probes are cached inside probe-event payloads,
which is also how the "never reuse a question within 60 days" rule is
enforced (`recentProbeQuestions` reads them back).

## Module boundaries

Two interfaces isolate the judgement-making parts so either can be replaced
without touching the log, routes, or UI:

### `MemoryModel` (`server/src/memory/MemoryModel.ts`)

v1 is **ts-fsrs applied per item** (`fsrs.ts`) — a deliberately "Newtonian"
approximation: one closed-form forgetting curve per item, updated by discrete
ratings. The rating mapping lives in exactly one function:

- fail = 1, partial = 2, pass = 3 at recognition/cued
- pass at typed/explain = 3, or **4** when response time beat the learner's
  median (computed from the log)
- sweep passes log rating 3, flagged `sweep_pass: true` in the payload

**Migration path to a latent-state model.** A replacement implements the same
three capabilities — `initState`, `review` (more generally: *update on
evidence*), `retrievability(at)` — but consumes the raw `evidence_events`
stream instead of a scalar rating. Because every consumer goes through the
interface and the log is complete, the swap is: (1) implement the interface,
(2) replay the log to build its state, (3) delete `fsrs.ts`. A latent-state
model would also subsume propagation natively (a joint posterior over related
items), at which point the experiment below is deleted rather than ported.

### `SchedulerPolicy` (`server/src/scheduler/SchedulerPolicy.ts`)

v1 (`v1.ts`) is rule-based over FSRS retrievability:

- **Modality ladder** — stability < 2 d → recognition MCQ (using the 3
  distractors cached at ingest, so recognition probes cost no API call for
  options); 2–21 d → cued recall; > 21 d or R > 0.95 → typed/explain. A fail
  demotes the next probe one level; passes at typed/explain are the only path
  to long intervals.
- **Queue order** — relearn-priority items, then due items, both ascending
  retrievability; new items appended, ≤ 10/day.
- **Contrast interleaving** — items sharing a `contrasts_with` edge are placed
  adjacently; distinction items get contrast-style probes.
- **Goal conditioning** — within 14 days of a goal's target date, items switch
  to successive-relearning: each must pass in ≥ 3 distinct sessions (counted
  from the log), and items below that bar jump the queue even if not due.
  After the date, items relax to maintenance (review only when R < 0.75).
- **Sweep trigger** — when any goal has ≥ 8 reviewed items with R < 0.92, the
  session opens with a free-recall sweep of the most at-risk goal region; the
  AI diff turns one dump into many per-item evidence events.

A future policy against a latent-state model would optimise expected gain in
goal-weighted retrievability directly, but emits the same `SessionPlan`.

## The session runner (`server/src/session/engine.ts`)

Sessions are ephemeral in-memory compose-and-run state; nothing durable lives
there. Probes are **pre-fetched**: fetching probe N kicks off generation of
N + 1 in the background, so dead time between probes is the time of one cache
read in the common case. Any fail triggers the error loop-back: a ≤ 3-sentence
corrective (logged as a `correction` event) and a recognition-level re-probe
appended near the session's end — a session never ends with an item left
failed (retries are capped at 2 per item to guarantee termination).

## The AI layer (`server/src/ai/`)

All AI calls go through one `AIBackend` interface. The real backend renders
the exported template functions in `server/src/prompts/` (ingestion,
distractors, probe-gen per modality, sweep-diff, grading, dedupe, corrective)
and validates **every** JSON response against a Zod schema, with one
corrective retry and then a clean user-facing error. `MockBackend` implements
the same interface with deterministic heuristics; it powers **demo mode**
(usable with no API key, clearly labelled) and the test suite, including the
full-loop e2e test.

## Propagation (EXPERIMENTAL — off by default)

Behind the `propagation_enabled` setting: on a probe pass, items connected by
edges with weight ≥ 0.7 receive a small multiplicative stability bonus,
hard-capped at ≤ 10% (in practice 5% × edge weight). Caveats, honestly:

- It is a heuristic bolted onto a model that assumes item independence; FSRS
  stabilities were not fit with cross-item transfer in mind.
- It can inflate stability without evidence, so the bonus is deliberately tiny,
  applies only to already-reviewed items, and writes **no evidence event** —
  the log stays honest; only the belief cache is nudged.
- It will be deleted, not ported, when a latent-state model lands.

## Data model

SQLite at `./data/tract.db` (WAL). Tables: `items` (+ cached MCQ
`distractors` JSON), `edges`, `memory_states`, `evidence_events`, `goals`,
`goal_items`, `settings` (api_key, daily_minutes, fsrs params,
propagation_enabled), `snapshots` (a daily on-start job records each goal's
projected score on its target date). Goals replace decks/subjects entirely;
items link to goals via `goal_items`.
