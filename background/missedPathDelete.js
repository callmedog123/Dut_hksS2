// @ts-check

import { RESPONSE_ERROR_CODES } from "../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../storage/repository.js";

export class MissedPathDeleteError extends Error {
  constructor(code, message, retryable, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "MissedPathDeleteError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {{deleteMissedPath: (id: string) => Promise<boolean>}} repository
 */
export function createMissedPathDeleteUseCase(repository) {
  if (!isRecord(repository) || typeof repository.deleteMissedPath !== "function") {
    throw new TypeError(
      "Missed Path delete requires Repository.deleteMissedPath()."
    );
  }

  return Object.freeze({
    async execute(payload) {
      try {
        const deleted = await repository.deleteMissedPath(payload.missedPathId);
        if (typeof deleted !== "boolean") {
          throw new TypeError("Repository returned invalid delete data.");
        }
        return { missedPathId: payload.missedPathId, deleted };
      } catch (error) {
        if (error instanceof RepositoryVersionError) {
          throw new MissedPathDeleteError(
            RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
            error.message,
            false,
            error
          );
        }
        if (error instanceof RepositoryDataError) {
          throw new MissedPathDeleteError(
            RESPONSE_ERROR_CODES.MISSED_PATH_DELETE_FAILED,
            error.message,
            false,
            error
          );
        }
        throw new MissedPathDeleteError(
          RESPONSE_ERROR_CODES.STORAGE_ERROR,
          "Unable to delete the Missed Path.",
          true,
          error
        );
      }
    }
  });
}
