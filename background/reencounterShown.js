// @ts-check

import { RESPONSE_ERROR_CODES } from "../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../storage/repository.js";

export class ReencounterShownError extends Error {
  constructor(code, message, retryable, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ReencounterShownError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isResult(value) {
  return Boolean(
    isRecord(value) &&
      Object.keys(value).length === 4 &&
      typeof value.reencounterId === "string" &&
      value.reencounterId.length > 0 &&
      typeof value.missedPathId === "string" &&
      value.missedPathId.length > 0 &&
      typeof value.shownAt === "number" &&
      Number.isFinite(value.shownAt) &&
      value.shownAt >= 0 &&
      typeof value.created === "boolean"
  );
}

/**
 * Persist one rendered Re-encounter card through the Repository authority.
 *
 * @param {{recordReencounterShown: (payload: object) => Promise<unknown>}} repository
 */
export function createReencounterShownUseCase(repository) {
  if (
    !isRecord(repository) ||
    typeof repository.recordReencounterShown !== "function"
  ) {
    throw new TypeError(
      "Re-encounter shown requires Repository.recordReencounterShown()."
    );
  }

  return Object.freeze({
    async execute(payload, tabId) {
      try {
        const result = await repository.recordReencounterShown(payload, tabId);
        if (!isResult(result)) {
          throw new TypeError("Repository returned invalid shown data.");
        }
        return result;
      } catch (error) {
        if (error instanceof RepositoryVersionError) {
          throw new ReencounterShownError(
            RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
            error.message,
            false,
            error
          );
        }
        if (error instanceof RepositoryDataError) {
          const code = error.code === "MISSED_PATH_NOT_FOUND"
            ? RESPONSE_ERROR_CODES.MISSED_PATH_NOT_FOUND
            : error.code === "REENCOUNTER_SHOWN_STALE"
              ? RESPONSE_ERROR_CODES.REENCOUNTER_SHOWN_STALE
              : RESPONSE_ERROR_CODES.REENCOUNTER_SHOWN_CONFLICT;
          throw new ReencounterShownError(code, error.message, false, error);
        }
        throw new ReencounterShownError(
          RESPONSE_ERROR_CODES.STORAGE_ERROR,
          "Unable to persist the Re-encounter shown record.",
          true,
          error
        );
      }
    }
  });
}
