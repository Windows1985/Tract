import { beforeAll, describe, expect, it } from "vitest";
import { addGoal, daysAhead, freshDb, insertItem, newMemoryState, setMemoryState } from "./helpers.js";
import { getDb, setSetting } from "../src/db.js";
import { setAIBackend } from "../src/ai/index.js";
import { MockBackend } from "../src/ai/mock.js";
import {
  finishSession,
  getProbe,
  memoryModel,
  startSession,
  submitAnswer,
  submitCalibration,
  submitSweep,
  type Session,
} from "../src/session/engine.js";
import { loadState } from "../src/memory/store.js";
import { State } from "ts-fsrs";

// Full loop end-to-end against the mocked AI layer:
// ingest → sweep → every probe modality → fail loop-back → calibration →
// verify evidence_events and memory_states are correct.

describe("end-to-end session loop (mocked AI)", () => {
  beforeAll(() => {
    freshDb();
    setAIBackend(new MockBackend());
    setSetting("daily_minutes", "30"); // room for everything in one session
  });

  it("runs the entire loop and leaves a correct evidence log", async () => {
    const mock = new MockBackend();

    // --- ingest: extract from raw material via the AI layer, commit manually ---
    const material = `Oxidation is the loss of electrons from a species.
Reduction is the gain of electrons by a species.
A catalyst lowers the activation energy of a reaction without being consumed.
Equilibrium shifts to counteract any imposed change in conditions.
Entropy measures how dispersed the energy of a system is.
Enthalpy is the heat content of a system at constant pressure.
Activation energy is the minimum energy needed to start a reaction.
Exothermic reactions release heat into their surroundings.
Endothermic reactions absorb heat from their surroundings.`;
    const extraction = await mock.extract(material);
    expect(extraction.items.length).toBe(9);
    const ids = extraction.items.map((it) =>
      insertItem({ statement: it.statement, kind: it.kind, distractors: it.distractors })
    );
    ids.forEach((id) => newMemoryState(id));
    addGoal("Chemistry", daysAhead(60), ids);

    // Age every item so a sweep triggers and modalities span all levels:
    // idx 0..5 weak-reviewed (cued band), idx 6 high stability (typed),
    // idx 7 concept-ish explain candidate, idx 8 stays New (mcq).
    for (let i = 0; i < 6; i++) setMemoryState(ids[i], { stability: 5, lastReviewDaysAgo: 6, dueDaysAgo: 1 });
    setMemoryState(ids[6], { stability: 40, lastReviewDaysAgo: 60, dueDaysAgo: 1 });
    setMemoryState(ids[7], { stability: 40, lastReviewDaysAgo: 60, dueDaysAgo: 1 });
    getDb().prepare("UPDATE items SET kind = 'concept' WHERE id = ?").run(ids[7]);
    getDb().prepare("UPDATE items SET kind = 'distinction' WHERE id = ?").run(ids[6]);

    // --- start: sweep is scheduled for the at-risk goal region ---
    const session: Session = startSession();
    expect(session.plan.sweep).not.toBeNull();
    expect(session.plan.queue.length).toBeGreaterThan(0);

    // --- sweep: cover two items, slip the rest ---
    const sweepResult = await submitSweep(
      session,
      "Oxidation is when a species loses electrons. Reduction is when a species gains electrons.",
      85_000
    );
    expect(sweepResult.covered).toBeGreaterThanOrEqual(1);
    expect(session.sweepDone).toBe(true);

    // --- probes: walk the whole queue, failing the first probe on purpose ---
    const modalitiesSeen = new Set<string>();
    let failedItemId: string | null = null;
    let sawRetry = false;

    for (let i = 0; i < session.plan.queue.length; i++) {
      const probe = await getProbe(session, i);
      modalitiesSeen.add(probe.modality);
      expect(probe.question.length).toBeGreaterThan(3);

      if (probe.isRetry) {
        sawRetry = true;
        expect(probe.modality).toBe("mcq"); // loop-back re-probe is recognition level
      }

      if (probe.modality === "mcq") {
        const item = getDb().prepare("SELECT statement FROM items WHERE id = ?").get(probe.itemId) as {
          statement: string;
        };
        const correct = probe.options!.indexOf(item.statement);
        expect(correct).toBeGreaterThanOrEqual(0);
        if (failedItemId === null && !probe.isRetry) {
          // Deliberate fail → corrective + loop-back.
          failedItemId = probe.itemId;
          const r = await submitAnswer(session, i, 4000, { optionIndex: (correct + 1) % 4 });
          expect(r.outcome).toBe("fail");
          expect(r.corrective).toBeTruthy();
          expect(session.plan.queue[session.plan.queue.length - 1].itemId).toBe(probe.itemId);
          expect(session.plan.queue[session.plan.queue.length - 1].isRetry).toBe(true);
        } else {
          const r = await submitAnswer(session, i, 3000, { optionIndex: correct });
          expect(r.outcome).toBe("pass");
        }
      } else if (probe.modality === "cued") {
        expect(probe.canonical).toBeTruthy(); // think → reveal needs the canonical statement
        const r = await submitAnswer(session, i, 5000, { selfRating: "partial" });
        expect(r.outcome).toBe("partial");
      } else {
        // typed / explain — answer with the canonical statement → mock grades pass
        const item = getDb().prepare("SELECT statement FROM items WHERE id = ?").get(probe.itemId) as {
          statement: string;
        };
        const r = await submitAnswer(session, i, 6000, { text: item.statement });
        // Grading is deferred; flush it so loop-back / corrective run before next iteration.
        await Promise.all([...session.pendingGrades.values()]);
        const verdict = [...session.deferredVerdicts.values()].find((v) => v.index === i);
        expect(verdict?.outcome ?? r.outcome).toBe("pass");
      }
    }

    expect(failedItemId).not.toBeNull();
    expect(sawRetry).toBe(true); // never end a session with an item left failed
    for (const m of ["mcq", "cued", "typed", "explain"]) {
      expect(modalitiesSeen.has(m), `modality ${m} exercised`).toBe(true);
    }

    // --- calibration ---
    const cal = submitCalibration(session, 80);
    expect(cal.actual).toBeGreaterThan(0);
    expect(cal.actual).toBeLessThanOrEqual(100);
    expect(cal.note.length).toBeGreaterThan(0);

    // --- finish ---
    const fin = finishSession(session);
    expect(fin.deltas.length).toBe(1);
    expect(fin.deltas[0].after).toBeGreaterThanOrEqual(fin.deltas[0].before);

    // --- verify the evidence log ---
    const db = getDb();
    const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
    expect(count("SELECT COUNT(*) n FROM evidence_events WHERE type='sweep'")).toBeGreaterThanOrEqual(2);
    expect(count("SELECT COUNT(*) n FROM evidence_events WHERE type='probe'")).toBe(session.plan.queue.length);
    expect(count("SELECT COUNT(*) n FROM evidence_events WHERE type='correction'")).toBeGreaterThanOrEqual(1);
    expect(count("SELECT COUNT(*) n FROM evidence_events WHERE type='calibration'")).toBe(1);

    // The failed item: fail probe + correction + retry probe, all in the log.
    const failEvents = db
      .prepare("SELECT * FROM evidence_events WHERE item_id = ? ORDER BY created_at")
      .all(failedItemId) as any[];
    const types = failEvents.map((e) => `${e.type}:${e.outcome ?? "-"}`);
    expect(types).toContain("probe:fail");
    expect(types).toContain("correction:-");
    const retryEvent = failEvents.find((e) => e.type === "probe" && JSON.parse(e.payload).retry === true);
    expect(retryEvent).toBeTruthy();
    expect(retryEvent.outcome).toBe("pass");

    // Probe payloads cache the generated question (never-reuse window).
    for (const e of db.prepare("SELECT payload FROM evidence_events WHERE type='probe'").all() as any[]) {
      const p = JSON.parse(e.payload);
      expect(typeof p.question).toBe("string");
      expect(p.session_id).toBe(session.id);
      expect([1, 2, 3, 4]).toContain(p.rating);
    }

    // --- verify memory_states ---
    for (const id of ids) {
      const st = loadState(id)!;
      expect(st.state).not.toBe(State.New); // everything got at least one review
      expect(st.reps).toBeGreaterThan(0);
      const r = memoryModel.retrievability(st);
      expect(r).toBeGreaterThan(0.5);
      expect(r).toBeLessThanOrEqual(1);
      expect(new Date(st.due).getTime()).toBeGreaterThan(Date.now() - 1000);
    }

    // Daily snapshot was written on start.
    expect(count("SELECT COUNT(*) n FROM snapshots")).toBe(1);
  });
});
