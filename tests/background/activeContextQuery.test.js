import assert from "node:assert/strict";
import test from "node:test";

import {
  ActiveContextQueryError,
  createActiveContextQueryUseCase
} from "../../background/activeContextQuery.js";
import { ACTIVE_CONTEXT_STATUSES } from "../../shared/messages.js";
import { createRepository } from "../../storage/repository.js";
import { createTransactionalMemoryStorageAdapter } from "../storage/fixtures/memoryStorageAdapter.js";

function createContext() {
  return {
    query: "robot navigation",
    source: "local-demo",
    timestamp: 100,
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

test("returns a successful unavailable state when no context is active", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  const useCase = createActiveContextQueryUseCase(repository);

  const result = {
    status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
    context: null
  };
  assert.deepEqual(await useCase.execute(), result);
  assert.deepEqual(await useCase.execute(), result);
  assert.equal(adapter.commitCount, 0);
});

test("returns the durable current SearchContext without exposing Repository metadata", async () => {
  const adapter = createTransactionalMemoryStorageAdapter();
  const repository = createRepository(adapter);
  await repository.mergeDiscoveredCandidates({
    sessionId: "session-1",
    context: createContext(),
    candidates: [createCandidate()],
    discoveredAt: 200
  });
  const commitsBeforeQuery = adapter.commitCount;
  const useCase = createActiveContextQueryUseCase(repository);

  const first = await useCase.execute();
  const repeated = await useCase.execute();

  assert.deepEqual(first, {
    status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
    context: createContext()
  });
  assert.deepEqual(repeated, first);
  assert.equal(adapter.commitCount, commitsBeforeQuery);
  assert.deepEqual(await repository.listReencounters(), []);
});

test("surfaces storage failures as retryable Active Context query errors", async () => {
  const failure = new Error("simulated storage failure");
  const useCase = createActiveContextQueryUseCase({
    async getActiveContext() {
      throw failure;
    }
  });

  await assert.rejects(
    () => useCase.execute(),
    (error) =>
      error instanceof ActiveContextQueryError &&
      error.code === "STORAGE_ERROR" &&
      error.retryable === true &&
      error.cause === failure
  );
});
