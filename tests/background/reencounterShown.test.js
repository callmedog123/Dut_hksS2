import assert from "node:assert/strict";
import test from "node:test";

import {
  ReencounterShownError,
  createReencounterShownUseCase
} from "../../background/reencounterShown.js";
import { RESPONSE_ERROR_CODES } from "../../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../../storage/repository.js";

const shown = Object.freeze({
  id: "shown-1",
  missedPathId: "missed-1",
  triggerContext: {
    query: "robot navigation",
    source: "local-demo",
    timestamp: 100
  },
  score: 0.8,
  reasons: [
    {
      code: "CONTEXT_MATCH",
      label: "Context matched.",
      contribution: 0.4
    }
  ],
  shownAt: 200
});

test("persists shown payload and returns the Repository result", async () => {
  let received = null;
  const useCase = createReencounterShownUseCase({
    async recordReencounterShown(payload) {
      received = payload;
      return {
        reencounterId: payload.id,
        missedPathId: payload.missedPathId,
        shownAt: payload.shownAt,
        created: true
      };
    }
  });

  assert.deepEqual(await useCase.execute(shown), {
    reencounterId: "shown-1",
    missedPathId: "missed-1",
    shownAt: 200,
    created: true
  });
  assert.equal(received, shown);
});

test("maps unknown Missed Path and identity conflict to explicit errors", async () => {
  for (const [repositoryCode, responseCode] of [
    ["MISSED_PATH_NOT_FOUND", RESPONSE_ERROR_CODES.MISSED_PATH_NOT_FOUND],
    [
      "REENCOUNTER_SHOWN_CONFLICT",
      RESPONSE_ERROR_CODES.REENCOUNTER_SHOWN_CONFLICT
    ],
    [
      "REENCOUNTER_SHOWN_STALE",
      RESPONSE_ERROR_CODES.REENCOUNTER_SHOWN_STALE
    ]
  ]) {
    const useCase = createReencounterShownUseCase({
      async recordReencounterShown() {
        throw new RepositoryDataError("rejected", repositoryCode);
      }
    });
    await assert.rejects(
      () => useCase.execute(shown),
      (error) =>
        error instanceof ReencounterShownError &&
        error.code === responseCode &&
        error.retryable === false
    );
  }
});

test("maps schema incompatibility and storage failure without swallowing", async () => {
  const versionUseCase = createReencounterShownUseCase({
    async recordReencounterShown() {
      throw new RepositoryVersionError(2);
    }
  });
  await assert.rejects(
    () => versionUseCase.execute(shown),
    (error) =>
      error instanceof ReencounterShownError &&
      error.code === RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED &&
      error.retryable === false
  );

  const storageUseCase = createReencounterShownUseCase({
    async recordReencounterShown() {
      throw new Error("offline");
    }
  });
  await assert.rejects(
    () => storageUseCase.execute(shown),
    (error) =>
      error instanceof ReencounterShownError &&
      error.code === RESPONSE_ERROR_CODES.STORAGE_ERROR &&
      error.retryable === true
  );
});

test("rejects malformed Repository success data", async () => {
  const useCase = createReencounterShownUseCase({
    async recordReencounterShown() {
      return { created: true };
    }
  });
  await assert.rejects(
    () => useCase.execute(shown),
    (error) =>
      error instanceof ReencounterShownError &&
      error.code === RESPONSE_ERROR_CODES.STORAGE_ERROR
  );
});
