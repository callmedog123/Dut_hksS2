import assert from "node:assert/strict";
import test from "node:test";

import {
  SignalsUpdateError,
  createSignalsUpdateUseCase
} from "../../background/signalsUpdate.js";
import { RESPONSE_ERROR_CODES } from "../../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../../storage/repository.js";

const payload = {
  signals: {
    candidateId: "candidate-1",
    sessionId: "session-1",
    visibleMs: 1_000,
    hoverMs: 200,
    hoverCount: 2,
    returnCount: 1,
    clicked: false
  },
  updatedAt: 250
};

test("delegates one absolute signals snapshot to the Repository", async () => {
  let received;
  const expected = {
    sessionId: "session-1",
    candidateId: "candidate-1",
    updatedAt: 250,
    changed: true
  };
  const useCase = createSignalsUpdateUseCase({
    async mergeCandidateSignalsSnapshot(value) {
      received = value;
      return expected;
    }
  });

  assert.deepEqual(await useCase.execute(payload), expected);
  assert.equal(received, payload);
});

test("maps Repository data conflicts to a non-retryable signals error", async () => {
  const useCase = createSignalsUpdateUseCase({
    async mergeCandidateSignalsSnapshot() {
      throw new RepositoryDataError("Candidate is not part of session.");
    }
  });

  await assert.rejects(
    () => useCase.execute(payload),
    (error) =>
      error instanceof SignalsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.SIGNALS_UPDATE_CONFLICT &&
      error.retryable === false
  );
});

test("maps repository version incompatibility to a non-retryable error", async () => {
  const useCase = createSignalsUpdateUseCase({
    async mergeCandidateSignalsSnapshot() {
      throw new RepositoryVersionError(2);
    }
  });

  await assert.rejects(
    () => useCase.execute(payload),
    (error) =>
      error instanceof SignalsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED &&
      error.retryable === false
  );
});

test("maps storage failures to a retryable signals error", async () => {
  const useCase = createSignalsUpdateUseCase({
    async mergeCandidateSignalsSnapshot() {
      throw new Error("simulated storage failure");
    }
  });

  await assert.rejects(
    () => useCase.execute(payload),
    (error) =>
      error instanceof SignalsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.STORAGE_ERROR &&
      error.retryable === true
  );
});
