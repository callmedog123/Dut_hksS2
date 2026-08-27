import assert from "node:assert/strict";
import test from "node:test";

import {
  DataDeleteAllError,
  createDataDeleteAllUseCase
} from "../../background/dataDeleteAll.js";
import { RESPONSE_ERROR_CODES } from "../../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../../storage/repository.js";

test("returns populated and repeated empty clear results", async () => {
  const results = [true, false];
  const useCase = createDataDeleteAllUseCase({
    async deleteAll() {
      return results.shift();
    }
  });
  assert.deepEqual(await useCase.execute({ requestedAt: 500 }), {
    deleted: true
  });
  assert.deepEqual(await useCase.execute({ requestedAt: 600 }), {
    deleted: false
  });
});

test("maps clear version, data, storage, and malformed-result failures", async () => {
  for (const [thrown, code, retryable] of [
    [
      new RepositoryVersionError(2),
      RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
      false
    ],
    [
      new RepositoryDataError("invalid"),
      RESPONSE_ERROR_CODES.DATA_DELETE_ALL_FAILED,
      false
    ],
    [new Error("offline"), RESPONSE_ERROR_CODES.STORAGE_ERROR, true]
  ]) {
    const useCase = createDataDeleteAllUseCase({
      async deleteAll() {
        throw thrown;
      }
    });
    await assert.rejects(
      () => useCase.execute({ requestedAt: 500 }),
      (error) =>
        error instanceof DataDeleteAllError &&
        error.code === code &&
        error.retryable === retryable
    );
  }
  const malformed = createDataDeleteAllUseCase({
    async deleteAll() {
      return undefined;
    }
  });
  await assert.rejects(
    () => malformed.execute({ requestedAt: 500 }),
    (error) =>
      error instanceof DataDeleteAllError &&
      error.code === RESPONSE_ERROR_CODES.STORAGE_ERROR
  );
});
