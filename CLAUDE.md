# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (runs server :5174 + Vite dev server :5173 concurrently)
npm run dev

# Type-check both workspaces
npm run build

# Run all server tests (Vitest)
npm test

# Run a single test file
npm test -w server -- modality.test.ts

# Production
npm run build && npm start
```

The repo is an npm workspace: `server/` and `client/` are separate packages with their own `package.json`. Run workspace-scoped commands with `-w server` or `-w client`.

## Architecture

```
evidence_events (append-only log)
    └── MemoryModel (FSRS)  →  memory_states (derived cache)
    └── SchedulerPolicy     →  SessionPlan  →  session engine
                                                    └── AIBackend (probe gen, grading, sweep-diff)
```

### The invariant that drives everything

`evidence_events` is the source of truth. It is append-only by SQLite trigger — no row can be updated or deleted. Every other table is either derived (`memory_states`) or mutable-with-`updated_at` (`items`, `edges`, `goals`, `goal_items`). Deleting `memory_states` and replaying the log through `MemoryModel` reconstructs state exactly.

### Key interfaces (the two seams)

- **`MemoryModel`** (`server/src/memory/MemoryModel.ts`) — abstracts FSRS. v1 is per-item FSRS via ts-fsrs (`fsrs.ts`). To replace with a latent-state model: implement the interface, replay the log, delete `fsrs.ts`.
- **`SchedulerPolicy`** (`server/src/scheduler/SchedulerPolicy.ts`) — abstracts queue building. v1 (`v1.ts`) is rule-based: modality ladder, contrast interleaving, goal-conditioned successive-relearning, sweep trigger at R < 0.92 on ≥ 8 items.

### AI layer

All AI calls go through `AIBackend` (`server/src/ai/backend.ts`). Real backend: Anthropic claude-haiku-\* via `@anthropic-ai/sdk`. Mock backend (`mock.ts`): deterministic heuristics — powers demo mode (no API key needed) and the entire test suite. Every response is validated against a Zod schema with one corrective retry. Prompt templates live in `server/src/prompts/`.

### Session flow

1. `POST /api/session/start` → SchedulerPolicy builds a `SessionPlan` (optional sweep + probe queue).
2. Client fetches probe N, which triggers background pre-fetch of N+1.
3. Each answer hits `POST /api/session/:id/answer` → AI grades → evidence logged → MemoryModel updated.
4. Fails get a corrective + recognition-level re-probe appended to the queue. Sessions never end on a fail.

### Ingest pipeline

Raw text → `segmentNotes` (splits into atomic propositions) → `ingestion` prompt extracts items + edges + MCQ distractors → `dedupe` checks against existing items → items written to DB with edges. The extracted items are the unit of scheduling, not the source material.

### Error taxonomy

Failed probe outcomes are classified (`error_type`): `blank` (no response), `near_miss` (close but wrong), `confident_wrong` (asserted incorrect fact). Logged on `evidence_events`, used for corrective generation.

### Propagation (off by default)

When `propagation_enabled` setting is true: a probe pass nudges stability of connected items (edge weight ≥ 0.7) by ≤ 10%. Heuristic only — writes no evidence event, leaves log honest. Will be deleted when a latent-state model lands.

### Sync-readiness

Schema is prepared for CR-SQLite multi-device sync: `evidence_events` has DB-level immutability triggers, mutable tables have `updated_at` columns, `sync_metadata` table exists. No CR-SQLite dependency yet.

## Data

SQLite at `./data/tract.db` (WAL mode). Tables: `items`, `edges`, `memory_states`, `evidence_events`, `goals`, `goal_items`, `settings`, `snapshots`, `sync_metadata`.

## Tests

Test files live in `server/` (not in a subdirectory). Key coverage: modality selection (`modality.test.ts`), queue building + contrast interleaving (`scheduler.test.ts`), FSRS rating mapping (`rating.test.ts`), per-modality rescaling (`rescaler.test.ts`), sweep diff application (`sweep.test.ts`), error taxonomy (`errorType.test.ts`), note segmentation (`segmentNotes.test.ts`), full e2e session loop against MockBackend (`e2e.test.ts`).

## Client

React 18 + TypeScript + Vite + Tailwind v3 + framer-motion. Screens: `Home`, `SessionScreen`, `IngestScreen`, `KeyScreen`, `SettingsSheet`, `TopicsPanel`. Shared components in `widgets.tsx`. Motion presets in `motion.ts`. All server communication via thin `api.ts` wrappers (`get`/`post`).

Fonts: Geist Variable (body), Space Grotesk Variable (display). Icons: Phosphor (`@phosphor-icons/react`) for primary UI; Lucide retained for utility icons (`X`, `Check`, etc.) in screens.
