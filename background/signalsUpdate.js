// @ts-check

import { RESPONSE_ERROR_CODES } from "../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../storage/repository.js";

export class SignalsUpdateError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.name = "SignalsUpdateError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRepository(repository) {
  if (
    !isRecord(repository) ||
    typeof repository.mergeCandidateSignalsSnapshot !== "function"
  ) {
    throw new TypeError(
      "Signals update requires Repository.mergeCandidateSignalsSnapshot()."
    );
  }
}

/**
 * Persist one cumulative absolute CandidateSignalsV1 snapshot. Repository
 * state, rather than Worker memory or requestId, provides idempotence.
 *
 * @param {{mergeCandidateSignalsSnapshot: (payload: object) => Promise<unknown>}} repository
 */
export function createSignalsUpdateUseCase(repository) {
  assertRepository(repository);

  return Object.freeze({
    /** @param {object} payload */
    async execute(payload) {
      try {
        return await repository.mergeCandidateSignalsSnapshot(payload);
      } catch (error) {
        if (error instanceof RepositoryVersionError) {
          throw new SignalsUpdateError(
            RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
            error.message,
            false
          );
        }
        if (error instanceof RepositoryDataError) {
          throw new SignalsUpdateError(
            RESPONSE_ERROR_CODES.SIGNALS_UPDATE_CONFLICT,
            error.message,
            false
          );
        }
        throw new SignalsUpdateError(
          RESPONSE_ERROR_CODES.STORAGE_ERROR,
          "Unable to persist Candidate signals.",
          true
        );
      }
    }
  });
}
