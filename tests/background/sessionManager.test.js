import assert from "node:assert/strict";
import test from "node:test";

import { createSessionManager } from "../../background/sessionManager.js";
import { CONSIDERATION_SCORING_CONFIG } from "../../background/scoringConfig.js";
import { createRepository } from "../../storage/repository.js";
import { createTransactionalMemoryStorageAdapter } from "../storage/fixtures/memoryStorageAdapter.js";

function createCandidate(id, rank) {
  return {
    id,
    url: `https://example.com/${id}`,
    title: `Result ${id}`,
    source: "local-demo",
    rank,
    sessionId: "session-1"
  };
}

function createSignals(candidateId, overrides = {}) {
  return {
    candidateId,
    sessionId: "session-1",
    visibleMs: 0,
    hoverMs: 0,
    hoverCount: 0,
    returnCount: 0,
    clicked: false,
    ...overrides
  };
}

function createSession(entries) {
  return {
    sessionId: "session-1",
    context: {
      query: "robot navigation",
      source: "local-demo",
      timestamp: 100,
      keywords: ["robot", "navigation"]
    },
    candidates: entries,
    updatedAt: 200
  };
}

function entry(id, rank, signalOverrides = {}) {
  return {
    candidate: createCandidate(id, rank),
    signals: createSignals(id, signalOverrides)
  };
}

async function setup(session) {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.saveSession(session);
  return {
    adapter,
    repository,
    manager: createSessionManager(repository)
  };
}

test("clicked Candidate becomes Chosen and is excluded from MissedPath", async () => {
  const { repository, manager } = await setup(
    createSession([
      entry("clicked", 1, {
        visibleMs: 10_000,
        hoverMs: 3_000,
        hoverCount: 4,
        returnCount: 2,
        clicked: true
      })
    ])
  );

  const result = await manager.finalizeSession("session-1", 500);

  assert.equal(result.alreadyFinalized, false);
  assert.equal(result.chosen.length, 1);
  assert.equal(result.chosen[0].candidate.id, "clicked");
  assert.deepEqual(result.missedPaths, []);
  assert.equal((await repository.listChosen()).length, 1);
  assert.deepEqual(await repository.listMissedPaths(), []);
});

test("only unclicked Candidates at or above the threshold become MissedPath", async () => {
  const { repository, manager } = await setup(
    createSession([
      entry("at-threshold", 1, {
        visibleMs: 10_000,
        returnCount: 2
      }),
      entry("below-threshold", 2, {
        visibleMs: 9_999,
        returnCount: 2
      })
    ])
  );

  const result = await manager.finalizeSession("session-1", 500);

  assert.equal(result.missedPaths.length, 1);
  assert.equal(result.missedPaths[0].candidate.id, "at-threshold");
  assert.equal(
    result.missedPaths[0].score,
    CONSIDERATION_SCORING_CONFIG.threshold
  );
  assert.equal(result.missedPaths[0].status, "MISSED");
  assert.equal(
    result.missedPaths[0].reasons.some(
      (reason) => reason.code === "RETURN_VIEW"
    ),
    true
  );
  assert.deepEqual(await repository.listMissedPaths(), result.missedPaths);
});

test("repeated finalize is idempotent and does not create duplicates", async () => {
  const { adapter, repository, manager } = await setup(
    createSession([
      entry("missed", 1, { visibleMs: 10_000, hoverMs: 3_000 })
    ])
  );
  const first = await manager.finalizeSession("session-1", 500);
  const commitsAfterFirst = adapter.commitCount;

  const second = await manager.finalizeSession("session-1", 900);

  assert.equal(first.alreadyFinalized, false);
  assert.equal(second.alreadyFinalized, true);
  assert.equal(second.finalizedAt, 500);
  assert.deepEqual(second.missedPaths, first.missedPaths);
  assert.equal(adapter.commitCount, commitsAfterFirst);
  assert.equal((await repository.listMissedPaths()).length, 1);
});

test("empty session finalizes once with no Chosen or MissedPath", async () => {
  const { repository, manager } = await setup(createSession([]));

  const result = await manager.finalizeSession("session-1", 500);

  assert.deepEqual(result.chosen, []);
  assert.deepEqual(result.missedPaths, []);
  assert.deepEqual(
    await repository.getSessionFinalization("session-1"),
    {
      sessionId: "session-1",
      finalizedAt: 500,
      chosenIds: [],
      missedPathIds: []
    }
  );
});

test("a new manager and Repository recover finalized state after restart", async () => {
  const { adapter, manager } = await setup(
    createSession([
      entry("missed", 1, { visibleMs: 10_000, hoverMs: 3_000 })
    ])
  );
  const first = await manager.finalizeSession("session-1", 500);

  const restartedRepository = createRepository(adapter);
  const restartedManager = createSessionManager(restartedRepository);
  const recovered = await restartedManager.finalizeSession("session-1", 900);

  assert.equal(recovered.alreadyFinalized, true);
  assert.equal(recovered.finalizedAt, 500);
  assert.deepEqual(recovered.missedPaths, first.missedPaths);
  assert.equal((await restartedRepository.listMissedPaths()).length, 1);
});

test("persisted chosen survives restart and cannot become a MissedPath", async () => {
  const { adapter, manager } = await setup(
    createSession([
      entry("considered-then-chosen", 1, {
        visibleMs: 10_000,
        hoverMs: 3_000,
        hoverCount: 4,
        returnCount: 2
      })
    ])
  );

  assert.deepEqual(
    await manager.recordCandidateChosen(
      "session-1",
      "considered-then-chosen",
      450
    ),
    {
      sessionId: "session-1",
      candidateId: "considered-then-chosen",
      updated: true
    }
  );

  const restartedRepository = createRepository(adapter);
  const restartedManager = createSessionManager(restartedRepository);
  const persistedSession = await restartedRepository.getSession("session-1");
  assert.deepEqual(
    persistedSession.candidates[0].signals,
    createSignals("considered-then-chosen", {
      visibleMs: 10_000,
      hoverMs: 3_000,
      hoverCount: 4,
      returnCount: 2,
      clicked: true
    })
  );

  const finalized = await restartedManager.finalizeSession("session-1", 500);
  assert.equal(finalized.chosen.length, 1);
  assert.deepEqual(finalized.missedPaths, []);

  const afterSecondRestart = createSessionManager(createRepository(adapter));
  const repeated = await afterSecondRestart.finalizeSession("session-1", 900);
  assert.equal(repeated.alreadyFinalized, true);
  assert.equal(repeated.finalizedAt, 500);
  assert.equal(repeated.chosen.length, 1);
  assert.deepEqual(repeated.missedPaths, []);
});

test("storage failure leaves no contradictory outputs and a retry can settle", async () => {
  const { adapter, repository, manager } = await setup(
    createSession([
      entry("clicked", 1, { clicked: true }),
      entry("missed", 2, { visibleMs: 10_000, hoverMs: 3_000 })
    ])
  );
  const failure = new Error("simulated atomic finalization failure");
  adapter.failNextCommit(failure);

  await assert.rejects(
    () => manager.finalizeSession("session-1", 500),
    (error) => error === failure
  );
  assert.deepEqual(await repository.listChosen(), []);
  assert.deepEqual(await repository.listMissedPaths(), []);
  assert.equal(await repository.getSessionFinalization("session-1"), null);

  const retry = await manager.finalizeSession("session-1", 500);
  assert.equal(retry.chosen.length, 1);
  assert.equal(retry.missedPaths.length, 1);
});
