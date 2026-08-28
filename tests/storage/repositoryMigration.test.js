import assert from "node:assert/strict";
import test from "node:test";

import { SCHEMA_VERSION } from "../../shared/types.js";
import { createIndexedDbStorageAdapter } from "../../storage/indexedDbStorageAdapter.js";
import {
  REPOSITORY_KINDS,
  REPOSITORY_SCHEMA_KEY,
  RepositoryVersionError,
  createRepository
} from "../../storage/repository.js";
import { createFakeIndexedDB } from "./fixtures/fakeIndexedDB.js";
import { createTransactionalMemoryStorageAdapter } from "./fixtures/memoryStorageAdapter.js";

const LEGACY_SCHEMA_VERSION = 1;

function createContext(timestamp = 100) {
  return {
    query: "robot navigation",
    source: "local-demo",
    timestamp,
    keywords: ["robot", "navigation"]
  };
}

function createCandidate() {
  return {
    id: "candidate-1",
    url: "https://example.com/result",
    title: "Example result",
    source: "local-demo",
    rank: 1,
    sessionId: "session-1"
  };
}

function createLegacyDataset() {
  const context = createContext();
  const candidate = createCandidate();
  const session = {
    sessionId: "session-1",
    context,
    candidates: [
      {
        candidate,
        signals: {
          candidateId: candidate.id,
          sessionId: candidate.sessionId,
          visibleMs: 10_000,
          hoverMs: 3_000,
          hoverCount: 4,
          returnCount: 2,
          clicked: true
        }
      }
    ],
    updatedAt: 200
  };
  const activeContext = {
    sessionId: session.sessionId,
    context,
    activatedAt: 200
  };
  const chosen = {
    id: "chosen-1",
    candidate,
    context,
    chosenAt: 250
  };
  const missedPath = {
    id: "missed-1",
    candidate: {
      ...candidate,
      id: "candidate-2",
      url: "https://example.com/missed",
      title: "Missed result",
      rank: 2
    },
    context,
    score: 0.7,
    reasons: [
      {
        code: "LONG_EXPOSURE",
        label: "Visible time contributed.",
        contribution: 0.3
      }
    ],
    status: "MISSED",
    createdAt: 300
  };
  const reencounter = {
    id: "reencounter-1",
    missedPathId: missedPath.id,
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
    outcome: "LATER",
    feedbackAt: 500
  };
  const settings = {
    enabled: false,
    allowlist: ["example.com"],
    blocklist: ["blocked.example"],
    thresholds: { consideration: 0.55, reencounter: 0.6 },
    demoMode: false
  };
  const finalization = {
    sessionId: session.sessionId,
    finalizedAt: 600,
    chosenIds: [chosen.id],
    missedPathIds: [missedPath.id]
  };

  return {
    data: {
      activeContext,
      chosen,
      finalization,
      missedPath,
      reencounter,
      session,
      settings
    },
    entries: [
      {
        key: REPOSITORY_SCHEMA_KEY,
        value: { schemaVersion: LEGACY_SCHEMA_VERSION }
      },
      legacyRecord(REPOSITORY_KINDS.SESSION, session.sessionId, session),
      legacyRecord(
        REPOSITORY_KINDS.ACTIVE_CONTEXT,
        "current",
        activeContext
      ),
      legacyRecord(REPOSITORY_KINDS.CHOSEN, chosen.id, chosen),
      legacyRecord(REPOSITORY_KINDS.MISSED_PATH, missedPath.id, missedPath),
      legacyRecord(REPOSITORY_KINDS.REENCOUNTER, reencounter.id, reencounter),
      legacyRecord(REPOSITORY_KINDS.SETTINGS, "current", settings),
      legacyRecord(
        REPOSITORY_KINDS.SESSION_FINALIZATION,
        finalization.sessionId,
        finalization
      )
    ]
  };
}

function legacyRecord(kind, id, data) {
  return {
    key: `${kind}:${id}`,
    value: {
      schemaVersion: LEGACY_SCHEMA_VERSION,
      kind,
      id,
      data
    }
  };
}

test("atomically migrates every complete v1 record and feedback to v2", async () => {
  const indexedDB = createFakeIndexedDB();
  const adapter = createIndexedDbStorageAdapter({
    indexedDB,
    databaseName: "repository-complete-v1-migration"
  });
  const legacy = createLegacyDataset();
  await adapter.commit({ puts: legacy.entries });

  const repository = createRepository(adapter);
  assert.equal(await repository.getSchemaVersion(), SCHEMA_VERSION);
  assert.deepEqual(await repository.getSession("session-1"), legacy.data.session);
  assert.deepEqual(await repository.getActiveContext(), legacy.data.activeContext);
  assert.deepEqual(await repository.getChosen("chosen-1"), legacy.data.chosen);
  assert.deepEqual(
    await repository.getMissedPath("missed-1"),
    legacy.data.missedPath
  );
  assert.deepEqual(
    await repository.getReencounter("reencounter-1"),
    legacy.data.reencounter
  );
  assert.deepEqual(await repository.getSettings(), legacy.data.settings);
  assert.deepEqual(
    await repository.getSessionFinalization("session-1"),
    legacy.data.finalization
  );

  const migrated = await adapter.entries();
  assert.equal(
    migrated.every(({ value }) => value.schemaVersion === SCHEMA_VERSION),
    true
  );
  assert.equal(migrated.length, legacy.entries.length);
});

test("migration remains queryable, deletable and clearable", async () => {
  const adapter = createTransactionalMemoryStorageAdapter(
    createLegacyDataset().entries
  );
  const repository = createRepository(adapter);

  assert.equal((await repository.listMissedPaths()).length, 1);
  assert.equal(await repository.deleteMissedPath("missed-1"), true);
  assert.deepEqual(await repository.listMissedPaths(), []);
  assert.deepEqual(await repository.listReencounters(), []);
  assert.equal(await repository.deleteAll(), true);
  assert.deepEqual(await repository.listSessions(), []);
  assert.deepEqual(await repository.listChosen(), []);
  assert.deepEqual(await repository.getSettings(), createLegacyDataset().data.settings);
  assert.equal(await repository.getSchemaVersion(), SCHEMA_VERSION);
});

test("initializes an empty database directly at v2", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);

  assert.equal(await repository.getSchemaVersion(), SCHEMA_VERSION);
  assert.deepEqual(adapter.snapshot(), [
    {
      key: REPOSITORY_SCHEMA_KEY,
      value: { schemaVersion: SCHEMA_VERSION }
    }
  ]);
});

test("repeated migration is idempotent and performs no second rewrite", async () => {
  const adapter = createTransactionalMemoryStorageAdapter(
    createLegacyDataset().entries
  );
  const firstRepository = createRepository(adapter);
  await firstRepository.getSchemaVersion();
  const afterFirstMigration = adapter.snapshot();
  assert.equal(adapter.commitCount, 1);

  const restartedRepository = createRepository(adapter);
  await restartedRepository.getSchemaVersion();
  assert.deepEqual(adapter.snapshot(), afterFirstMigration);
  assert.equal(adapter.commitCount, 1);
});

test("a failed migration transaction rolls back every v1 record", async () => {
  const indexedDB = createFakeIndexedDB();
  const adapter = createIndexedDbStorageAdapter({
    indexedDB,
    databaseName: "repository-v1-migration-rollback"
  });
  const legacy = createLegacyDataset();
  await adapter.commit({ puts: legacy.entries });
  const failure = new Error("simulated migration write failure");
  indexedDB.failWriteAfter(legacy.entries.length - 1, failure);

  const repository = createRepository(adapter);
  await assert.rejects(
    () => repository.getSchemaVersion(),
    (error) => error === failure
  );
  assert.deepEqual(await adapter.entries(), legacy.entries);

  assert.equal(await repository.getSchemaVersion(), SCHEMA_VERSION);
  assert.equal(
    (await adapter.entries()).every(
      ({ value }) => value.schemaVersion === SCHEMA_VERSION
    ),
    true
  );
});

test("unknown versions and non-empty metadata-free stores fail without writes", async () => {
  for (const initialEntries of [
    [
      {
        key: REPOSITORY_SCHEMA_KEY,
        value: { schemaVersion: SCHEMA_VERSION + 1 }
      }
    ],
    [legacyRecord(REPOSITORY_KINDS.SETTINGS, "current", createLegacyDataset().data.settings)]
  ]) {
    const adapter = createTransactionalMemoryStorageAdapter(initialEntries);
    const repository = createRepository(adapter);

    await assert.rejects(
      () => repository.getSchemaVersion(),
      (error) => error instanceof RepositoryVersionError
    );
    assert.deepEqual(adapter.snapshot(), initialEntries);
    assert.equal(adapter.commitCount, 0);
  }
});
