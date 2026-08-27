// @ts-check

import { RESPONSE_ERROR_CODES } from "../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../storage/repository.js";

export class DataDeleteAllError extends Error {
  constructor(code, message, retryable, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DataDeleteAllError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {{deleteAll: () => Promise<boolean>}} repository */
export function createDataDeleteAllUseCase(repository) {
  if (!isRecord(repository) || typeof repository.deleteAll !== "function") {
    throw new TypeError("Data delete all requires Repository.deleteAll().");
  }

  return Object.freeze({
    async execute() {
      try {
        const deleted = await repository.deleteAll();
        if (typeof deleted !== "boolean") {
          throw new TypeError("Repository returned invalid clear data.");
        }
        return { deleted };
      } catch (error) {
        if (error instanceof RepositoryVersionError) {
          throw new DataDeleteAllError(
            RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
            error.message,
            false,
            error
          );
        }
        if (error instanceof RepositoryDataError) {
          throw new DataDeleteAllError(
            RESPONSE_ERROR_CODES.DATA_DELETE_ALL_FAILED,
            error.message,
            false,
            error
          );
        }
        throw new DataDeleteAllError(
          RESPONSE_ERROR_CODES.STORAGE_ERROR,
          "Unable to clear local data.",
          true,
          error
        );
      }
    }
  });
}
