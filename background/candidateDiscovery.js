// @ts-check

import { RESPONSE_ERROR_CODES } from "../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../storage/repository.js";

export class CandidateDiscoveryError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.name = "CandidateDiscoveryError";
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
    typeof repository.mergeDiscoveredCandidates !== "function"
  ) {
    throw new TypeError(
      "Candidate discovery requires Repository.mergeDiscoveredCandidates()."
    );
  }
}

/**
 * Persist one strict Candidate discovery batch. Repository state is the only
 * source of idempotence so Worker restarts do not change the result.
 *
 * @param {{mergeDiscoveredCandidates: (payload: object) => Promise<unknown>}} repository
 */
export function createCandidateDiscoveryUseCase(repository) {
  assertRepository(repository);

  return Object.freeze({
    /**
     * @param {object} payload
     */
    async execute(payload) {
      try {
        return await repository.mergeDiscoveredCandidates(payload);
      } catch (error) {
        if (error instanceof RepositoryVersionError) {
          throw new CandidateDiscoveryError(
            RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
            error.message,
            false
          );
        }
        if (error instanceof RepositoryDataError) {
          throw new CandidateDiscoveryError(
            RESPONSE_ERROR_CODES.CANDIDATE_DISCOVERY_CONFLICT,
            error.message,
            false
          );
        }
        throw new CandidateDiscoveryError(
          RESPONSE_ERROR_CODES.STORAGE_ERROR,
          "Unable to persist discovered Candidates.",
          true
        );
      }
    }
  });
}
