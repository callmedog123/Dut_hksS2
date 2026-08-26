import assert from "node:assert/strict";
import test from "node:test";

import {
  ReencounterFeedbackError,
  createReencounterFeedbackUseCase
} from "../../background/reencounterFeedback.js";
import {
  REENCOUNTER_FEEDBACK_OUTCOMES,
  RESPONSE_ERROR_CODES
} from "../../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../../storage/repository.js";

const feedback = Object.freeze({
  reencounterId: "shown-1",
  outcome: REENCOUNTER_FEEDBACK_OUTCOMES.LATER,
  feedbackAt: 300
});

test("persists feedback and returns the strict Repository result", async () => {
  let received = null;
  const useCase = createReencounterFeedbackUseCase({
    async recordReencounterFeedback(payload) {
      received = payload;
      return { ...payload, updated: true };
    }
  });

  assert.deepEqual(await useCase.execute(feedback), {
    ...feedback,
    updated: true
  });
  assert.equal(received, feedback);
});

test("maps missing and conflicting feedback to explicit errors", async () => {
  for (const [repositoryCode, responseCode] of [
    ["REENCOUNTER_NOT_FOUND", RESPONSE_ERROR_CODES.REENCOUNTER_NOT_FOUND],
    [
      "REENCOUNTER_FEEDBACK_CONFLICT",
      RESPONSE_ERROR_CODES.REENCOUNTER_FEEDBACK_CONFLICT
    ]
  ]) {
    const useCase = createReencounterFeedbackUseCase({
      async recordReencounterFeedback() {
        throw new RepositoryDataError("rejected", repositoryCode);
      }
    });
    await assert.rejects(
      () => useCase.execute(feedback),
      (error) =>
        error instanceof ReencounterFeedbackError &&
        error.code === responseCode &&
        error.retryable === false
    );
  }
});

test("maps schema incompatibility, storage failure, and malformed success", async () => {
  for (const [thrown, code, retryable] of [
    [
      new RepositoryVersionError(2),
      RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
      false
    ],
    [new Error("offline"), RESPONSE_ERROR_CODES.STORAGE_ERROR, true]
  ]) {
    const useCase = createReencounterFeedbackUseCase({
      async recordReencounterFeedback() {
        throw thrown;
      }
    });
    await assert.rejects(
      () => useCase.execute(feedback),
      (error) =>
        error instanceof ReencounterFeedbackError &&
        error.code === code &&
        error.retryable === retryable
    );
  }

  const malformed = createReencounterFeedbackUseCase({
    async recordReencounterFeedback() {
      return { updated: true };
    }
  });
  await assert.rejects(
    () => malformed.execute(feedback),
    (error) =>
      error instanceof ReencounterFeedbackError &&
      error.code === RESPONSE_ERROR_CODES.STORAGE_ERROR &&
      error.retryable === true
  );
});
