import assert from "node:assert/strict";
import test from "node:test";

import { createSessionManager } from "../../background/sessionManager.js";
import {
  RepositoryDataError,
  createRepository
} from "../../storage/repository.js";
import { createTransactionalMemoryStorageAdapter } from "./fixtures/memoryStorageAdapter.js";

function createOwner(tabId, documentId, sessionId) {
  return { tabId, documentId, frameId: 0, sessionId };
}

function createContext(query, timestamp) {
  return {
    query,
    source: "bilibili-search",
    timestamp,
    keywords: query.split(" ")
  };
}

function createCandidate(sessionId, id = "candidate-1", rank = 1) {
  return {
    id,
    url: `https://www.bilibili.com/video/${id}`,
    title: `Result ${id}`,
    source: "bilibili-search",
    rank,
    sessionId
  };
}

function createSignals(sessionId, visibleMs) {
  return {
    candidateId: "candidate-1",
    sessionId,
    visibleMs,
    hoverMs: 3_000,
    hoverCount: 4,
    returnCount: 2,
    clicked: false
  };
}

async function discover(repository, owner, context, discoveredAt, candidates) {
  return repository.mergeDiscoveredCandidates(
    {
      sessionId: owner.sessionId,
      context,
      candidates: candidates ?? [createCandidate(owner.sessionId)],
      discoveredAt
    },
    owner
  );
}

test("isolates identical query and session IDs across two tab owners", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const firstOwner = createOwner(1, "document-a", "shared-session");
  const secondOwner = createOwner(2, "document-b", "shared-session");
  const firstContext = createContext("robot navigation", 100);
  const secondContext = createContext("robot navigation", 101);

  await discover(repository, firstOwner, firstContext, 100);
  await discover(repository, secondOwner, secondContext, 101);
  assert.equal((await repository.listSessions()).length, 2);
  assert.deepEqual(
    (await repository.getSession("shared-session", firstOwner)).owner,
    firstOwner
  );
  assert.deepEqual(
    (await repository.getSession("shared-session", secondOwner)).owner,
    secondOwner
  );

  await repository.mergeCandidateSignalsSnapshot(
    { signals: createSignals("shared-session", 10_000), updatedAt: 200 },
    firstOwner
  );
  await repository.mergeCandidateSignalsSnapshot(
    { signals: createSignals("shared-session", 20_000), updatedAt: 201 },
    secondOwner
  );
  assert.equal(
    (await repository.getSession("shared-session", firstOwner))
      .candidates[0].signals.visibleMs,
    10_000
  );
  assert.equal(
    (await repository.getSession("shared-session", secondOwner))
      .candidates[0].signals.visibleMs,
    20_000
  );

  const manager = createSessionManager(repository);
  const firstFinalized = await manager.finalizeSession(
    "shared-session",
    300,
    firstOwner
  );
  assert.equal(firstFinalized.missedPaths.length, 1);
  assert.equal(await repository.getActiveContextForTab(1), null);
  assert.deepEqual(
    (await repository.getActiveContextForTab(2)).context,
    secondContext
  );

  await assert.rejects(
    () =>
      repository.mergeCandidateSignalsSnapshot(
        {
          signals: createSignals("shared-session", 30_000),
          updatedAt: 400
        },
        firstOwner
      ),
    (error) =>
      error instanceof RepositoryDataError &&
      /finalized session/u.test(error.message)
  );
  const secondLateUpdate = await repository.mergeCandidateSignalsSnapshot(
    {
      signals: createSignals("shared-session", 30_000),
      updatedAt: 400
    },
    secondOwner
  );
  assert.equal(secondLateUpdate.changed, true);

  const secondFinalized = await manager.finalizeSession(
    "shared-session",
    500,
    secondOwner
  );
  assert.equal(secondFinalized.missedPaths.length, 1);
  assert.notEqual(
    firstFinalized.missedPaths[0].id,
    secondFinalized.missedPaths[0].id
  );
  assert.equal((await repository.listMissedPaths()).length, 2);
});

test("keeps same-tab documents isolated and ignores an older document's late context", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const oldOwner = createOwner(5, "document-old", "session-old");
  const newOwner = createOwner(5, "document-new", "session-new");
  const oldContext = createContext("old query", 100);
  const newContext = createContext("new query", 200);

  await discover(repository, oldOwner, oldContext, 100);
  await discover(repository, newOwner, newContext, 200);
  assert.equal((await repository.listSessions()).length, 2);
  assert.deepEqual(
    (await repository.getActiveContextForTab(5)).context,
    newContext
  );

  await discover(
    repository,
    oldOwner,
    oldContext,
    150,
    [
      createCandidate("session-old"),
      createCandidate("session-old", "candidate-2", 2)
    ]
  );
  assert.equal(
    (await repository.getSession("session-old", oldOwner)).candidates.length,
    2
  );
  assert.deepEqual(
    (await repository.getActiveContextForTab(5)).context,
    newContext
  );

  await createSessionManager(repository).finalizeSession(
    "session-new",
    300,
    newOwner
  );
  assert.equal(await repository.getActiveContextForTab(5), null);
  assert.notEqual(await repository.getSession("session-old", oldOwner), null);
});

test("legacy global context remains queryable but cannot impersonate a tab", async () => {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const context = createContext("legacy query", 100);
  await repository.mergeDiscoveredCandidates({
    sessionId: "legacy-session",
    context,
    candidates: [createCandidate("legacy-session")],
    discoveredAt: 100
  });

  assert.deepEqual((await repository.getActiveContext()).context, context);
  assert.equal(await repository.getActiveContextForTab(9), null);
  assert.notEqual(await repository.getSession("legacy-session"), null);
});

test("owner-aware discovery storage failure leaves no Session or Active Context", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const owner = createOwner(8, "document-failure", "session-failure");
  await repository.getSchemaVersion();
  const failure = new Error("simulated owner storage failure");
  adapter.failNextCommit(failure);

  await assert.rejects(
    () =>
      discover(
        repository,
        owner,
        createContext("failed query", 100),
        100
      ),
    (error) => error === failure
  );
  assert.deepEqual(await repository.listSessions(), []);
  assert.equal(await repository.getActiveContextForTab(owner.tabId), null);
});
