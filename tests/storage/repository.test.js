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
  await repository.saveSession(createSession());
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
  await repository.saveSession(createSession());
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
  await repository.getSchemaVersion();
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
