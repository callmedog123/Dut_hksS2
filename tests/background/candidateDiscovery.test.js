import assert from "node:assert/strict";
import test from "node:test";

import {
  CandidateDiscoveryError,
  createCandidateDiscoveryUseCase
} from "../../background/candidateDiscovery.js";
import { RESPONSE_ERROR_CODES } from "../../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../../storage/repository.js";

const payload = {
  sessionId: "session-1",
  context: {
    query: "robot navigation",
    source: "local-demo",
    timestamp: 100,
    keywords: ["robot", "navigation"]
  },
  candidates: [
    {
      id: "candidate-1",
      url: "https://example.com/result",
      title: "Example result",
      source: "local-demo",
      rank: 1,
      sessionId: "session-1"
    }
  ],
  discoveredAt: 200
};

test("delegates one discovery batch to the Repository", async () => {
  let received;
  const expected = {
    sessionId: "session-1",
    acceptedCandidateIds: ["candidate-1"],
    totalCandidateCount: 1,
    updatedAt: 200
  };
  const useCase = createCandidateDiscoveryUseCase({
    async mergeDiscoveredCandidates(value) {
      received = value;
      return expected;
    }
  });

  assert.deepEqual(await useCase.execute(payload), expected);
  assert.equal(received, payload);
});

test("maps Repository data conflicts to a non-retryable business error", async () => {
  const useCase = createCandidateDiscoveryUseCase({
    async mergeDiscoveredCandidates() {
      throw new RepositoryDataError("SearchContext conflicts with session.");
    }
  });

  await assert.rejects(
    () => useCase.execute(payload),
    (error) =>
      error instanceof CandidateDiscoveryError &&
      error.code === RESPONSE_ERROR_CODES.CANDIDATE_DISCOVERY_CONFLICT &&
      error.retryable === false
  );
});

test("maps repository version incompatibility to a non-retryable error", async () => {
  const useCase = createCandidateDiscoveryUseCase({
    async mergeDiscoveredCandidates() {
      throw new RepositoryVersionError(2);
    }
  });

  await assert.rejects(
    () => useCase.execute(payload),
    (error) =>
      error instanceof CandidateDiscoveryError &&
      error.code === RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED &&
      error.retryable === false
  );
});

test("maps storage failures to a retryable error", async () => {
  const useCase = createCandidateDiscoveryUseCase({
    async mergeDiscoveredCandidates() {
      throw new Error("simulated storage failure");
    }
  });

  await assert.rejects(
    () => useCase.execute(payload),
    (error) =>
      error instanceof CandidateDiscoveryError &&
      error.code === RESPONSE_ERROR_CODES.STORAGE_ERROR &&
      error.retryable === true
  );
});
