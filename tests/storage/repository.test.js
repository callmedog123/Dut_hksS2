import assert from "node:assert/strict";
import test from "node:test";

import {
  REPOSITORY_SCHEMA_KEY,
  RepositoryDataError,
  RepositoryVersionError,
  createRepository
} from "../../storage/repository.js";
import { SCHEMA_VERSION } from "../../shared/types.js";
import { createTransactionalMemoryStorageAdapter } from "./fixtures/memoryStorageAdapter.js";

function createCandidate(overrides = {}) {
  return {
    id: "candidate-1",
    url: "https://example.com/result",
    title: "Example result",
    source: "local-demo",
    rank: 1,
    sessionId: "session-1",
    ...overrides
  };
}

function createContext(timestamp = 100) {
  return {
    query: "robot navigation",
    source: "local-demo",
    timestamp,
    keywords: ["robot", "navigation"]
  };
}

function createSignals(overrides = {}) {
  return {
    candidateId: "candidate-1",
    sessionId: "session-1",
    visibleMs: 1_000,
    hoverMs: 200,
    hoverCount: 2,
    returnCount: 1,
    clicked: false,
    ...overrides
  };
}

function createSession(overrides = {}) {
  return {
    sessionId: "session-1",
    context: createContext(),
    candidates: [
      { candidate: createCandidate(), signals: createSignals() }
    ],
    updatedAt: 200,
    ...overrides
  };
}

function createDiscovery(candidates = [createCandidate()], overrides = {}) {
  return {
    sessionId: "session-1",
    context: createContext(),
    candidates,
    discoveredAt: 200,
    ...overrides
  };
}

function createChosen(overrides = {}) {
  return {
    id: "chosen-1",
    candidate: createCandidate(),
    context: createContext(),
    chosenAt: 250,
    ...overrides
  };
}

function createMissedPath(overrides = {}) {
  return {
    id: "missed-1",
    candidate: createCandidate(),
    context: createContext(),
    score: 0.7,
    reasons: [
      {
        code: "LONG_EXPOSURE",
        label: "Visible time contributed.",
        contribution: 0.3
      }
    ],
    status: "MISSED",
    createdAt: 300,
    ...overrides
  };
}

function createReencounter(overrides = {}) {
  return {
    id: "reencounter-1",
    missedPathId: "missed-1",
    triggerContext: createContext(400),
    score: 0.8,
    reasons: [
      {
        code: "CONTEXT_MATCH",
        label: "Context keywords matched.",
        contribution: 0.8
      }
    ],
    shownAt: 450,
    ...overrides
  };
}

function createSettings(overrides = {}) {
  return {
    enabled: true,
    allowlist: ["example.com"],
    blocklist: [],
    thresholds: { consideration: 0.55, reencounter: 0.6 },
    demoMode: false,
    ...overrides
  };
}

test("initializes schemaVersion and provides CRUD for every minimal record", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);

  assert.equal(await repository.getSchemaVersion(), SCHEMA_VERSION);
  assert.equal(await repository.saveSession(createSession()), true);
  assert.equal(await repository.saveChosen(createChosen()), true);
  assert.equal(await repository.saveMissedPath(createMissedPath()), true);
  assert.equal(await repository.saveReencounter(createReencounter()), true);
  assert.equal(await repository.saveSettings(createSettings()), true);

  assert.deepEqual(await repository.getSession("session-1"), createSession());
  assert.deepEqual(await repository.listSessions(), [createSession()]);
  assert.deepEqual(await repository.getChosen("chosen-1"), createChosen());
  assert.deepEqual(await repository.listChosen(), [createChosen()]);
  assert.deepEqual(
    await repository.getMissedPath("missed-1"),
    createMissedPath()
  );
  assert.deepEqual(await repository.listMissedPaths(), [createMissedPath()]);
  assert.deepEqual(
    await repository.getReencounter("reencounter-1"),
    createReencounter()
  );
  assert.deepEqual(await repository.listReencounters(), [createReencounter()]);
  assert.deepEqual(await repository.getSettings(), createSettings());

  const storedRecords = adapter
    .snapshot()
    .filter(({ key }) => key !== REPOSITORY_SCHEMA_KEY);
  assert.equal(
    storedRecords.every(({ value }) => value.schemaVersion === SCHEMA_VERSION),
    true
  );
});

test("uses shared MissedPath and Re-encounter reason validators compatibly", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const missedWithoutContribution = createMissedPath({
    reasons: [
      {
        code: "NOT_CLICKED",
        label: "The Candidate was not clicked."
      }
    ]
  });
  const reencounterWithPenalty = createReencounter({
    reasons: [
      {
        code: "COOLDOWN_PENALTY",
        label: "Cooldown reduced relevance.",
        contribution: -0.25
      }
    ]
  });

  await repository.saveMissedPath(missedWithoutContribution);
  await repository.saveReencounter(reencounterWithPenalty);

  assert.deepEqual(
    await repository.getMissedPath("missed-1"),
    missedWithoutContribution
  );
  assert.deepEqual(
    await repository.getReencounter("reencounter-1"),
    reencounterWithPenalty
  );
});

test("Repository rejects invalid shared MissedPath and Re-encounter reasons", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const invalidMissedPaths = [
    createMissedPath({ status: "UNKNOWN" }),
    createMissedPath({ score: 1.1 }),
    createMissedPath({
      reasons: [{ code: "UNKNOWN", label: "Unknown." }]
    }),
    createMissedPath({ extra: true })
  ];
  for (const missedPath of invalidMissedPaths) {
    await assert.rejects(
      () => repository.saveMissedPath(missedPath),
      RepositoryDataError
    );
  }

  const invalidReencounters = [
    createReencounter({
      reasons: [{ code: "UNKNOWN", label: "Unknown." }]
    }),
    createReencounter({
      reasons: [
        {
          code: "COOLDOWN_PENALTY",
          label: "Invalid penalty.",
          contribution: Number.NEGATIVE_INFINITY
        }
      ]
    })
  ];
  for (const reencounter of invalidReencounters) {
    await assert.rejects(
      () => repository.saveReencounter(reencounter),
      RepositoryDataError
    );
  }

  assert.equal(adapter.commitCount, 0);
});

test("records Re-encounter shown once and keeps exact repeats idempotent", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.saveMissedPath(createMissedPath());
  await repository.mergeDiscoveredCandidates(
    createDiscovery([createCandidate()], {
      context: createContext(400),
      discoveredAt: 400
    })
  );
  const shown = createReencounter({ id: "shown-1" });

  assert.deepEqual(await repository.recordReencounterShown(shown), {
    reencounterId: "shown-1",
    missedPathId: "missed-1",
    shownAt: 450,
    created: true
  });
  const commitsAfterFirst = adapter.commitCount;
  assert.deepEqual(await repository.recordReencounterShown(shown), {
    reencounterId: "shown-1",
    missedPathId: "missed-1",
    shownAt: 450,
    created: false
  });
  assert.equal(adapter.commitCount, commitsAfterFirst);
  assert.deepEqual(await repository.listReencounters(), [shown]);
});

test("records the same Missed Path again in a different trigger context", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveMissedPath(createMissedPath());
  await repository.mergeDiscoveredCandidates(
    createDiscovery([createCandidate()], {
      context: createContext(400),
      discoveredAt: 400
    })
  );
  const first = createReencounter({ id: "shown-context-1" });
  const second = createReencounter({
    id: "shown-context-2",
    triggerContext: createContext(500),
    shownAt: 550
  });

  assert.equal((await repository.recordReencounterShown(first)).created, true);
  await repository.mergeDiscoveredCandidates(
    createDiscovery(
      [
        createCandidate({
          id: "candidate-2",
          url: "https://example.com/result-2",
          title: "Second result",
          sessionId: "session-2"
        })
      ],
      {
        sessionId: "session-2",
        context: createContext(500),
        discoveredAt: 500
      }
    )
  );
  assert.equal((await repository.recordReencounterShown(second)).created, true);
  assert.deepEqual(await repository.listReencounters(), [first, second]);
});

test("rejects unknown Missed Path and conflicting shown identity", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const unknown = createReencounter({
    id: "shown-unknown",
    missedPathId: "missing"
  });
  await assert.rejects(
    () => repository.recordReencounterShown(unknown),
    (error) =>
      error instanceof RepositoryDataError &&
      error.code === "MISSED_PATH_NOT_FOUND"
  );

  await repository.saveMissedPath(createMissedPath());
  await repository.mergeDiscoveredCandidates(
    createDiscovery([createCandidate()], {
      context: createContext(400),
      discoveredAt: 400
    })
  );
  const shown = createReencounter({ id: "shown-conflict" });
  await repository.recordReencounterShown(shown);
  await assert.rejects(
    () =>
      repository.recordReencounterShown({
        ...shown,
        score: 0.9
      }),
    (error) =>
      error instanceof RepositoryDataError &&
      error.code === "REENCOUNTER_SHOWN_CONFLICT"
  );
  assert.deepEqual(await repository.getReencounter(shown.id), shown);
});

test("rejects a shown record after the authoritative context changes", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveMissedPath(createMissedPath());
  await repository.mergeDiscoveredCandidates(
    createDiscovery([createCandidate()], {
      context: createContext(500),
      discoveredAt: 500
    })
  );

  await assert.rejects(
    () =>
      repository.recordReencounterShown(
        createReencounter({ id: "shown-stale" })
      ),
    (error) =>
      error instanceof RepositoryDataError &&
      error.code === "REENCOUNTER_SHOWN_STALE"
  );
  assert.equal(await repository.getReencounter("shown-stale"), null);
});

test("shown storage failure rolls back without a partial record", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.saveMissedPath(createMissedPath());
  await repository.mergeDiscoveredCandidates(
    createDiscovery([createCandidate()], {
      context: createContext(400),
      discoveredAt: 400
    })
  );
  const failure = new Error("shown commit failed");
  adapter.failNextCommit(failure);

  await assert.rejects(
    () => repository.recordReencounterShown(createReencounter({ id: "shown-fail" })),
    (error) => error === failure
  );
  assert.equal(await repository.getReencounter("shown-fail"), null);
});

test("repeated writes are idempotent and updates replace one record", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const initialSession = createSession();

  assert.equal(await repository.saveSession(initialSession), true);
  const commitsAfterFirstSave = adapter.commitCount;
  assert.equal(await repository.saveSession(createSession()), false);
  assert.equal(adapter.commitCount, commitsAfterFirstSave);

  const updatedSession = createSession({
    updatedAt: 300,
    candidates: [
      {
        candidate: createCandidate(),
        signals: createSignals({ visibleMs: 2_000 })
      }
    ]
  });
  assert.equal(await repository.saveSession(updatedSession), true);
  assert.deepEqual(await repository.listSessions(), [updatedSession]);
});

test("atomically creates a discovered Session with zero-value signals", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const secondCandidate = createCandidate({
    id: "candidate-2",
    url: "https://example.com/result-2",
    title: "Second result",
    rank: 2
  });

  const result = await repository.mergeDiscoveredCandidates(
    createDiscovery([createCandidate(), secondCandidate])
  );

  assert.deepEqual(result, {
    sessionId: "session-1",
    acceptedCandidateIds: ["candidate-1", "candidate-2"],
    totalCandidateCount: 2,
    updatedAt: 200
  });
  assert.deepEqual(await repository.getSession("session-1"), {
    sessionId: "session-1",
    context: createContext(),
    candidates: [
      {
        candidate: createCandidate(),
        signals: createSignals({
          visibleMs: 0,
          hoverMs: 0,
          hoverCount: 0,
          returnCount: 0
        })
      },
      {
        candidate: secondCandidate,
        signals: createSignals({
          candidateId: "candidate-2",
          visibleMs: 0,
          hoverMs: 0,
          hoverCount: 0,
          returnCount: 0
        })
      }
    ],
    updatedAt: 200
  });
  assert.deepEqual(await repository.getActiveContext(), {
    sessionId: "session-1",
    context: createContext(),
    activatedAt: 200
  });
});

test("switches and restores the one durable active context idempotently", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.mergeDiscoveredCandidates(createDiscovery());
  const commitsAfterFirstDiscovery = adapter.commitCount;

  await repository.mergeDiscoveredCandidates(
    createDiscovery([createCandidate()], { discoveredAt: 300 })
  );
  assert.equal(adapter.commitCount, commitsAfterFirstDiscovery);

  const nextContext = {
    query: "world models",
    source: "local-demo",
    timestamp: 400,
    keywords: ["world", "models"]
  };
  const nextCandidate = createCandidate({
    id: "candidate-2",
    url: "https://example.com/world-models",
    title: "World models",
    sessionId: "session-2"
  });
  await repository.mergeDiscoveredCandidates(
    createDiscovery([nextCandidate], {
      sessionId: "session-2",
      context: nextContext,
      discoveredAt: 400
    })
  );

  const expectedActiveContext = {
    sessionId: "session-2",
    context: nextContext,
    activatedAt: 400
  };
  assert.deepEqual(await repository.getActiveContext(), expectedActiveContext);
  assert.deepEqual(
    await createRepository(adapter).getActiveContext(),
    expectedActiveContext
  );

  await repository.finalizeSessionAtomically({
    sessionId: "session-1",
    finalizedAt: 500,
    chosen: [],
    missedPaths: []
  });
  assert.deepEqual(await repository.getActiveContext(), expectedActiveContext);

  await repository.finalizeSessionAtomically({
    sessionId: "session-2",
    finalizedAt: 600,
    chosen: [],
    missedPaths: []
  });
  assert.equal(await repository.getActiveContext(), null);
});

test("merges only new Candidates and preserves existing signals", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.mergeDiscoveredCandidates(createDiscovery());
  await repository.saveSession(
    createSession({
      updatedAt: 250,
      candidates: [
        {
          candidate: createCandidate(),
          signals: createSignals({ visibleMs: 2_000, clicked: true })
        }
      ]
    })
  );

  const duplicate = await repository.mergeDiscoveredCandidates(
    createDiscovery(
      [createCandidate({ rank: 99 })],
      { discoveredAt: 300 }
    )
  );
  assert.deepEqual(duplicate, {
    sessionId: "session-1",
    acceptedCandidateIds: [],
    totalCandidateCount: 1,
    updatedAt: 250
  });

  const secondCandidate = createCandidate({
    id: "candidate-2",
    url: "https://example.com/result-2",
    title: "Second result",
    rank: 2
  });
  const merged = await repository.mergeDiscoveredCandidates(
    createDiscovery([secondCandidate], { discoveredAt: 300 })
  );
  assert.deepEqual(merged.acceptedCandidateIds, ["candidate-2"]);
  assert.equal(merged.totalCandidateCount, 2);
  assert.equal(merged.updatedAt, 300);

  const persisted = await repository.getSession("session-1");
  assert.deepEqual(persisted.candidates[0], {
    candidate: createCandidate(),
    signals: createSignals({ visibleMs: 2_000, clicked: true })
  });
  assert.deepEqual(persisted.candidates[1].signals, {
    candidateId: "candidate-2",
    sessionId: "session-1",
    visibleMs: 0,
    hoverMs: 0,
    hoverCount: 0,
    returnCount: 0,
    clicked: false
  });
});

test("rejects discovery identity, context, URL, and finalized conflicts", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.mergeDiscoveredCandidates(createDiscovery());

  await assert.rejects(
    () =>
      repository.mergeDiscoveredCandidates(
        createDiscovery([createCandidate()], { context: createContext(101) })
      ),
    (error) =>
      error instanceof RepositoryDataError &&
      /SearchContext conflicts/u.test(error.message)
  );
  await assert.rejects(
    () =>
      repository.mergeDiscoveredCandidates(
        createDiscovery([
          createCandidate({ title: "Conflicting title" })
        ])
      ),
    (error) =>
      error instanceof RepositoryDataError &&
      /identity conflicts/u.test(error.message)
  );
  await assert.rejects(
    () =>
      repository.mergeDiscoveredCandidates(
        createDiscovery([
          createCandidate({
            id: "candidate-2",
            title: "Conflicting URL",
            rank: 2
          })
        ])
      ),
    (error) =>
      error instanceof RepositoryDataError &&
      /URL conflicts/u.test(error.message)
  );

  await repository.finalizeSessionAtomically({
    sessionId: "session-1",
    finalizedAt: 500,
    chosen: [],
    missedPaths: []
  });
  await assert.rejects(
    () =>
      repository.mergeDiscoveredCandidates(
        createDiscovery([
          createCandidate({
            id: "candidate-2",
            url: "https://example.com/result-2",
            title: "Second result",
            rank: 2
          })
        ])
      ),
    (error) =>
      error instanceof RepositoryDataError &&
      /finalized session/u.test(error.message)
  );
});

test("failed Candidate discovery commit leaves no partial Session", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.getSchemaVersion();
  adapter.failNextCommit(new Error("simulated discovery failure"));

  await assert.rejects(() =>
    repository.mergeDiscoveredCandidates(
      createDiscovery([
        createCandidate(),
        createCandidate({
          id: "candidate-2",
          url: "https://example.com/result-2",
          title: "Second result",
          rank: 2
        })
      ])
    )
  );
  assert.equal(await repository.getSession("session-1"), null);
  assert.equal(await repository.getActiveContext(), null);
});

test("atomically merges absolute signals with fieldwise maxima", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.saveSession(createSession());
  const commitsBeforeUpdate = adapter.commitCount;

  const first = await repository.mergeCandidateSignalsSnapshot({
    signals: createSignals({
      visibleMs: 2_000,
      hoverMs: 100,
      hoverCount: 5,
      returnCount: 0,
      clicked: true
    }),
    updatedAt: 500
  });
  assert.deepEqual(first, {
    sessionId: "session-1",
    candidateId: "candidate-1",
    updatedAt: 500,
    changed: true
  });
  assert.equal(adapter.commitCount, commitsBeforeUpdate + 1);
  assert.deepEqual(
    (await repository.getSession("session-1")).candidates[0].signals,
    createSignals({
      visibleMs: 2_000,
      hoverMs: 200,
      hoverCount: 5,
      returnCount: 1,
      clicked: true
    })
  );

  const commitsBeforeExactRetry = adapter.commitCount;
  const exactRetry = await repository.mergeCandidateSignalsSnapshot({
    signals: createSignals({
      visibleMs: 2_000,
      hoverMs: 100,
      hoverCount: 5,
      returnCount: 0,
      clicked: true
    }),
    updatedAt: 500
  });
  assert.equal(exactRetry.changed, false);
  assert.equal(adapter.commitCount, commitsBeforeExactRetry);

  const late = await repository.mergeCandidateSignalsSnapshot({
    signals: createSignals({
      visibleMs: 3_000,
      hoverMs: 150,
      hoverCount: 4,
      returnCount: 1,
      clicked: false
    }),
    updatedAt: 300
  });
  assert.deepEqual(late, {
    sessionId: "session-1",
    candidateId: "candidate-1",
    updatedAt: 500,
    changed: true
  });
  assert.deepEqual(
    (await repository.getSession("session-1")).candidates[0].signals,
    createSignals({
      visibleMs: 3_000,
      hoverMs: 200,
      hoverCount: 5,
      returnCount: 1,
      clicked: true
    })
  );

  const commitsBeforeRepeat = adapter.commitCount;
  const repeated = await repository.mergeCandidateSignalsSnapshot({
    signals: createSignals({
      visibleMs: 3_000,
      hoverMs: 100,
      hoverCount: 2,
      returnCount: 0,
      clicked: false
    }),
    updatedAt: 250
  });
  assert.deepEqual(repeated, {
    sessionId: "session-1",
    candidateId: "candidate-1",
    updatedAt: 500,
    changed: false
  });
  assert.equal(adapter.commitCount, commitsBeforeRepeat);
});

test("rejects invalid, missing, mismatched, and finalized signal targets", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveSession(createSession());

  await assert.rejects(
    () =>
      repository.mergeCandidateSignalsSnapshot({
        signals: { ...createSignals(), hoverCount: -1 },
        updatedAt: 300
      }),
    (error) =>
      error instanceof RepositoryDataError &&
      /Invalid Candidate signals snapshot/u.test(error.message)
  );
  await assert.rejects(
    () =>
      repository.mergeCandidateSignalsSnapshot({
        signals: createSignals({ sessionId: "missing-session" }),
        updatedAt: 300
      }),
    (error) =>
      error instanceof RepositoryDataError &&
      /Session not found/u.test(error.message)
  );
  await assert.rejects(
    () =>
      repository.mergeCandidateSignalsSnapshot({
        signals: createSignals({ candidateId: "candidate-other" }),
        updatedAt: 300
      }),
    (error) =>
      error instanceof RepositoryDataError &&
      /not part of session/u.test(error.message)
  );

  await repository.finalizeSessionAtomically({
    sessionId: "session-1",
    finalizedAt: 500,
    chosen: [],
    missedPaths: []
  });
  await assert.rejects(
    () =>
      repository.mergeCandidateSignalsSnapshot({
        signals: createSignals(),
        updatedAt: 600
      }),
    (error) =>
      error instanceof RepositoryDataError &&
      /Cannot update finalized session/u.test(error.message)
  );
});

test("failed signals commit preserves the entire prior Session", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const original = createSession();
  await repository.saveSession(original);
  const failure = new Error("simulated signals persistence failure");
  adapter.failNextCommit(failure);

  await assert.rejects(
    () =>
      repository.mergeCandidateSignalsSnapshot({
        signals: createSignals({ visibleMs: 9_000, clicked: true }),
        updatedAt: 500
      }),
    (error) => error === failure
  );
  assert.deepEqual(await repository.getSession("session-1"), original);
});

test("atomically persists a chosen flag without changing aggregate signals", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const original = createSession();
  await repository.saveSession(original);
  const commitsBeforeChosen = adapter.commitCount;

  assert.equal(
    await repository.markCandidateChosen("session-1", "candidate-1", 500),
    true
  );
  const persisted = await repository.getSession("session-1");
  assert.deepEqual(persisted.candidates[0].signals, {
    ...original.candidates[0].signals,
    clicked: true
  });
  assert.equal(persisted.updatedAt, 500);
  assert.equal(adapter.commitCount, commitsBeforeChosen + 1);

  const restartedRepository = createRepository(adapter);
  assert.equal(
    await restartedRepository.markCandidateChosen(
      "session-1",
      "candidate-1",
      900
    ),
    false
  );
  assert.equal(adapter.commitCount, commitsBeforeChosen + 1);
  assert.deepEqual(
    (await restartedRepository.getSession("session-1")).candidates[0].signals,
    persisted.candidates[0].signals
  );
});

test("rejects a late chosen update after session finalization", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveSession(createSession());
  await repository.finalizeSessionAtomically({
    sessionId: "session-1",
    finalizedAt: 500,
    chosen: [],
    missedPaths: []
  });

  await assert.rejects(
    () => repository.markCandidateChosen("session-1", "candidate-1", 600),
    (error) =>
      error instanceof RepositoryDataError &&
      /Cannot update finalized session/u.test(error.message)
  );
  assert.equal(
    (await repository.getSession("session-1")).candidates[0].signals.clicked,
    false
  );
});

test("failed chosen persistence preserves every prior aggregate signal", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const original = createSession();
  await repository.saveSession(original);
  const failure = new Error("simulated chosen persistence failure");
  adapter.failNextCommit(failure);

  await assert.rejects(
    () => repository.markCandidateChosen("session-1", "candidate-1", 500),
    (error) => error === failure
  );
  assert.deepEqual(await repository.getSession("session-1"), original);
});

test("single-record deletes remove records and are idempotent", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.mergeDiscoveredCandidates(createDiscovery());
  await repository.saveChosen(createChosen());
  await repository.saveReencounter(createReencounter());
  await repository.saveSettings(createSettings());

  assert.equal(await repository.deleteSession("session-1"), true);
  assert.equal(await repository.deleteChosen("chosen-1"), true);
  assert.equal(
    await repository.deleteReencounter("reencounter-1"),
    true
  );
  assert.equal(await repository.deleteSettings(), true);
  assert.equal(await repository.getSession("session-1"), null);
  assert.equal(await repository.getActiveContext(), null);
  assert.equal(await repository.getChosen("chosen-1"), null);
  assert.equal(await repository.getReencounter("reencounter-1"), null);
  assert.equal(await repository.getSettings(), null);
  assert.equal(await repository.deleteSession("session-1"), false);
});

test("deleting a MissedPath atomically removes linked Reencounters", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.saveMissedPath(createMissedPath());
  await repository.saveReencounter(createReencounter());

  assert.equal(await repository.deleteMissedPath("missed-1"), true);
  assert.equal(await repository.getMissedPath("missed-1"), null);
  assert.equal(await repository.getReencounter("reencounter-1"), null);
  assert.equal(await repository.deleteMissedPath("missed-1"), false);
});

test("deleteAll clears domain data but keeps the compatible schemaVersion", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  await repository.mergeDiscoveredCandidates(createDiscovery());
  await repository.saveChosen(createChosen());
  await repository.saveMissedPath(createMissedPath());
  await repository.saveReencounter(createReencounter());
  await repository.saveSettings(createSettings());

  await repository.deleteAll();

  assert.equal(await repository.getSchemaVersion(), SCHEMA_VERSION);
  assert.deepEqual(await repository.listSessions(), []);
  assert.deepEqual(await repository.listChosen(), []);
  assert.deepEqual(await repository.listMissedPaths(), []);
  assert.deepEqual(await repository.listReencounters(), []);
  assert.equal(await repository.getActiveContext(), null);
  assert.equal(await repository.getSettings(), null);
});

test("rejects incompatible schemaVersion without writing", async () => {
  const adapter = createTransactionalMemoryStorageAdapter([
    {
      key: REPOSITORY_SCHEMA_KEY,
      value: { schemaVersion: SCHEMA_VERSION + 1 }
    }
  ]);
  const repository = createRepository(adapter);

  await assert.rejects(
    () => repository.getSchemaVersion(),
    (error) =>
      error instanceof RepositoryVersionError &&
      error.code === "SCHEMA_VERSION_UNSUPPORTED" &&
      error.actualVersion === SCHEMA_VERSION + 1
  );
  assert.equal(adapter.commitCount, 0);
});

test("failed transactions roll back every affected record and surface errors", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.saveMissedPath(createMissedPath());
  await repository.saveReencounter(createReencounter());
  const failure = new Error("simulated atomic commit failure");
  adapter.failNextCommit(failure);

  await assert.rejects(
    () => repository.deleteMissedPath("missed-1"),
    (error) => error === failure
  );
  assert.deepEqual(
    await repository.getMissedPath("missed-1"),
    createMissedPath()
  );
  assert.deepEqual(
    await repository.getReencounter("reencounter-1"),
    createReencounter()
  );
});

test("atomically persists session outputs and a durable idempotence marker", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.getSchemaVersion();
  const chosen = createChosen();
  const missedPath = createMissedPath({
    id: "missed-2",
    candidate: createCandidate({
      id: "candidate-2",
      url: "https://example.com/second",
      title: "Second result",
      rank: 2
    })
  });
  const commitsBeforeFinalization = adapter.commitCount;

  const first = await repository.finalizeSessionAtomically({
    sessionId: "session-1",
    finalizedAt: 500,
    chosen: [chosen],
    missedPaths: [missedPath]
  });

  assert.equal(first.created, true);
  assert.equal(adapter.commitCount, commitsBeforeFinalization + 1);
  assert.deepEqual(await repository.listChosen(), [chosen]);
  assert.deepEqual(await repository.listMissedPaths(), [missedPath]);
  assert.deepEqual(
    await repository.getSessionFinalization("session-1"),
    {
      sessionId: "session-1",
      finalizedAt: 500,
      chosenIds: ["chosen-1"],
      missedPathIds: ["missed-2"]
    }
  );

  const second = await repository.finalizeSessionAtomically({
    sessionId: "session-1",
    finalizedAt: 900,
    chosen: [chosen],
    missedPaths: [missedPath]
  });
  assert.equal(second.created, false);
  assert.equal(second.finalization.finalizedAt, 500);
  assert.equal(adapter.commitCount, commitsBeforeFinalization + 1);
});

test("failed atomic session finalization leaves no outputs or marker", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.mergeDiscoveredCandidates(createDiscovery());
  const failure = new Error("simulated finalization failure");
  adapter.failNextCommit(failure);

  await assert.rejects(
    () =>
      repository.finalizeSessionAtomically({
        sessionId: "session-1",
        finalizedAt: 500,
        chosen: [createChosen()],
        missedPaths: []
      }),
    (error) => error === failure
  );
  assert.deepEqual(await repository.listChosen(), []);
  assert.deepEqual(await repository.listMissedPaths(), []);
  assert.equal(await repository.getSessionFinalization("session-1"), null);
  assert.deepEqual(await repository.getActiveContext(), {
    sessionId: "session-1",
    context: createContext(),
    activatedAt: 200
  });
});

test("strict DTO validation prevents non-minimal or sensitive extra fields", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);

  await assert.rejects(
    () =>
      repository.saveMissedPath(
        createMissedPath({ pageHtml: "<html>full page</html>" })
      ),
    RepositoryDataError
  );
  await assert.rejects(
    () =>
      repository.saveSession(
        createSession({ mouseTrajectory: [{ x: 1, y: 2 }] })
      ),
    RepositoryDataError
  );
  await assert.rejects(
    () => repository.saveSettings(createSettings({ token: "secret" })),
    RepositoryDataError
  );
  assert.equal(adapter.commitCount, 0);
});
