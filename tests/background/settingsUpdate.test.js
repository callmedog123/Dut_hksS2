import assert from "node:assert/strict";
import test from "node:test";

import {
  SettingsUpdateError,
  createSettingsUpdateUseCase
} from "../../background/settingsUpdate.js";
import { RESPONSE_ERROR_CODES } from "../../shared/messages.js";
import { DEFAULT_SETTINGS_V1 } from "../../shared/types.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../../storage/repository.js";

test("updates only enabled while preserving the complete Settings DTO", async () => {
  const current = {
    ...DEFAULT_SETTINGS_V1,
    allowlist: ["example.com"],
    thresholds: { consideration: 0.7, reencounter: 0.8 },
    demoMode: true
  };
  let saved = null;
  const useCase = createSettingsUpdateUseCase({
    async getSettings() {
      return current;
    },
    async saveSettings(settings) {
      saved = settings;
      return true;
    }
  });

  assert.deepEqual(
    await useCase.execute({ enabled: false, requestedAt: 500 }),
    {
      settings: { ...current, enabled: false },
      updated: true
    }
  );
  assert.deepEqual(saved, { ...current, enabled: false });
});

test("keeps repeated Settings updates idempotent", async () => {
  const useCase = createSettingsUpdateUseCase({
    async getSettings() {
      return { ...DEFAULT_SETTINGS_V1, enabled: false };
    },
    async saveSettings() {
      return false;
    }
  });
  const result = await useCase.execute({ enabled: false, requestedAt: 500 });
  assert.equal(result.settings.enabled, false);
  assert.equal(result.updated, false);
});

test("maps Settings version, data, storage, and malformed-result failures", async () => {
  for (const [thrown, code, retryable] of [
    [
      new RepositoryVersionError(2),
      RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
      false
    ],
    [
      new RepositoryDataError("invalid"),
      RESPONSE_ERROR_CODES.SETTINGS_UPDATE_FAILED,
      false
    ],
    [new Error("offline"), RESPONSE_ERROR_CODES.STORAGE_ERROR, true]
  ]) {
    const useCase = createSettingsUpdateUseCase({
      async getSettings() {
        throw thrown;
      },
      async saveSettings() {
        return true;
      }
    });
    await assert.rejects(
      () => useCase.execute({ enabled: false, requestedAt: 500 }),
      (error) =>
        error instanceof SettingsUpdateError &&
        error.code === code &&
        error.retryable === retryable
    );
  }

  const malformed = createSettingsUpdateUseCase({
    async getSettings() {
      return DEFAULT_SETTINGS_V1;
    },
    async saveSettings() {
      return "yes";
    }
  });
  await assert.rejects(
    () => malformed.execute({ enabled: false, requestedAt: 500 }),
    (error) =>
      error instanceof SettingsUpdateError &&
      error.code === RESPONSE_ERROR_CODES.STORAGE_ERROR
  );
});
