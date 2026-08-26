import assert from "node:assert/strict";
import test from "node:test";

import {
  MissedPathDeleteError,
  createMissedPathDeleteUseCase
} from "../../background/missedPathDelete.js";
import { RESPONSE_ERROR_CODES } from "../../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../../storage/repository.js";

const payload = Object.freeze({ missedPathId: "missed-1", requestedAt: 500 });

test("returns existing and repeated Missed Path deletion results", async () => {
  const results = [true, false];
  const useCase = createMissedPathDeleteUseCase({
    async deleteMissedPath(id) {
      assert.equal(id, payload.missedPathId);
      return results.shift();
    }
  });

  assert.deepEqual(await useCase.execute(payload), {
    missedPathId: "missed-1",
    deleted: true
  });
  assert.deepEqual(await useCase.execute(payload), {
    missedPathId: "missed-1",
    deleted: false
  });
});

test("maps delete version, data, storage, and malformed-result failures", async () => {
  for (const [thrown, code, retryable] of [
    [
      new RepositoryVersionError(2),
      RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
      false
    ],
    [
      new RepositoryDataError("invalid"),
      RESPONSE_ERROR_CODES.MISSED_PATH_DELETE_FAILED,
      false
    ],
    [new Error("offline"), RESPONSE_ERROR_CODES.STORAGE_ERROR, true]
  ]) {
    const useCase = createMissedPathDeleteUseCase({
      async deleteMissedPath() {
        throw thrown;
      }
    });
    await assert.rejects(
      () => useCase.execute(payload),
      (error) =>
        error instanceof MissedPathDeleteError &&
        error.code === code &&
        error.retryable === retryable
    );
  }

  const malformed = createMissedPathDeleteUseCase({
    async deleteMissedPath() {
      return "yes";
    }
  });
  await assert.rejects(
    () => malformed.execute(payload),
    (error) =>
      error instanceof MissedPathDeleteError &&
      error.code === RESPONSE_ERROR_CODES.STORAGE_ERROR &&
      error.retryable === true
  );
});
