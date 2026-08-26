// @ts-check

import { RESPONSE_ERROR_CODES } from "../shared/messages.js";
import { isSettingsV1 } from "../shared/types.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../storage/repository.js";

export class SettingsUpdateError extends Error {
  constructor(code, message, retryable, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "SettingsUpdateError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {{getSettings: () => Promise<unknown>, saveSettings: (settings: object) => Promise<boolean>}} repository
 */
export function createSettingsUpdateUseCase(repository) {
  if (
    !isRecord(repository) ||
    typeof repository.getSettings !== "function" ||
    typeof repository.saveSettings !== "function"
  ) {
    throw new TypeError(
      "Settings update requires Repository.getSettings() and saveSettings()."
    );
  }

  return Object.freeze({
    async execute(payload) {
      try {
        const current = await repository.getSettings();
        if (!isSettingsV1(current)) {
          throw new RepositoryDataError("Stored settings data is invalid.");
        }
        const settings = { ...current, enabled: payload.enabled };
        const updated = await repository.saveSettings(settings);
        if (typeof updated !== "boolean") {
          throw new TypeError("Repository returned invalid settings data.");
        }
        return { settings, updated };
      } catch (error) {
        if (error instanceof RepositoryVersionError) {
          throw new SettingsUpdateError(
            RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
            error.message,
            false,
            error
          );
        }
        if (error instanceof RepositoryDataError) {
          throw new SettingsUpdateError(
            RESPONSE_ERROR_CODES.SETTINGS_UPDATE_FAILED,
            error.message,
            false,
            error
          );
        }
        throw new SettingsUpdateError(
          RESPONSE_ERROR_CODES.STORAGE_ERROR,
          "Unable to persist Settings.",
          true,
          error
        );
      }
    }
  });
}
