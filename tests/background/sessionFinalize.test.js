import assert from "node:assert/strict";
import test from "node:test";

import {
  SessionFinalizeError,
  createSessionFinalizeUseCase
} from "../../background/sessionFinalize.js";
import { RESPONSE_ERROR_CODES } from "../../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../../storage/repository.js";

const payload = {
  sessionId: "session-1",
  finalizedAt: 500
};

test("delegates finalization to the existing Session Manager", async () => {
  const calls = [];
  const expected = {
    sessionId: "session-1",
    finalizedAt: 500,
    alreadyFinalized: false,
    chosen: [],
    missedPaths: []
  };
  const useCase = createSessionFinalizeUseCase({
    async finalizeSession(sessionId, finalizedAt) {
      calls.push({ sessionId, finalizedAt });
      return expected;
    }
  });

  assert.deepEqual(await useCase.execute(payload), expected);
  assert.deepEqual(calls, [{ sessionId: "session-1", finalizedAt: 500 }]);
});

test("maps a missing Session to an explicit non-retryable error", async () => {
  const useCase = createSessionFinalizeUseCase({
    async finalizeSession() {
      throw new Error("Session not found: session-1");
    }
  });

  await assert.rejects(
    () => useCase.execute(payload),
    (error) =>
      error instanceof SessionFinalizeError &&
      error.code === RESPONSE_ERROR_CODES.SESSION_NOT_FOUND &&
      error.retryable === false
  );
});

test("maps repository incompatibility and data conflicts", async () => {
  const incompatible = createSessionFinalizeUseCase({
    async finalizeSession() {
      throw new RepositoryVersionError(2);
    }
  });
  await assert.rejects(
    () => incompatible.execute(payload),
    (error) =>
      error instanceof SessionFinalizeError &&
      error.code === RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED &&
      error.retryable === false
  );

  const conflict = createSessionFinalizeUseCase({
    async finalizeSession() {
      throw new RepositoryDataError("Atomic finalization conflicts.");
    }
  });
  await assert.rejects(
    () => conflict.execute(payload),
    (error) =>
      error instanceof SessionFinalizeError &&
      error.code === RESPONSE_ERROR_CODES.SESSION_FINALIZE_CONFLICT &&
      error.retryable === false
  );
});

test("maps atomic storage failures to a retryable error", async () => {
  const useCase = createSessionFinalizeUseCase({
    async finalizeSession() {
      throw new Error("simulated atomic storage failure");
    }
  });

  await assert.rejects(
    () => useCase.execute(payload),
    (error) =>
      error instanceof SessionFinalizeError &&
      error.code === RESPONSE_ERROR_CODES.STORAGE_ERROR &&
      error.retryable === true
  );
});
