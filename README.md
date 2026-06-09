# Tract

A memory partner. Feed it what you're learning; press **Start** every day.

Tract is a local-first learning system — not a flashcard app. There are no
cards, decks, study modes, or settings to choose. You give it material and
goals; it maintains a model of what you know and, each day, spends your
minutes on whatever most increases what you can do when it matters.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5173, paste your Anthropic API key (or click the demo
link to try it with a mocked AI), paste some notes, press Start. That's the
whole setup — no accounts, no seed data. Everything lives in
`./data/tract.db` on your machine.

For a production-style run: `npm run build && npm start` (serves the built
client from the API server at http://localhost:5174).

## What a session looks like

- **Free-recall sweep** (~90 s) when a goal region is at risk: "Write
  everything you know about ___." One dump updates many items at once.
- **Generated probes**, interleaved: recognition → cued recall → typed/explain
  as each item's memory strengthens. Questions are generated fresh every
  time — there is nothing to pattern-match. Confusable pairs are probed
  back-to-back.
- **Error loop-back**: any miss gets a three-sentence corrective and returns
  at the end of the session. A session never ends on a failure.
- **Calibration close**: guess how you did, see how you actually did.
- **End screen**: per-goal memory delta, minutes spent, weekly momentum.

## Stack

React 18 + TypeScript + Vite + Tailwind + framer-motion · Node + Express
(port 5174) · SQLite (better-sqlite3) · ts-fsrs as the v1 memory model ·
@anthropic-ai/sdk (backend only).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the evidence-event log, the
`MemoryModel` / `SchedulerPolicy` interfaces, and the migration path to a
latent-state model.

## Tests

```bash
npm test
```

Covers modality selection, queue building + contrast interleaving,
goal-conditioned prioritisation, sweep-diff event application, the FSRS
rating mapping, and a full end-to-end session loop against the mocked AI
layer (ingest → sweep → all modalities → fail loop-back → calibration).
