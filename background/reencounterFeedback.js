// @ts-check

import {
  REENCOUNTER_FEEDBACK_OUTCOMES,
  RESPONSE_ERROR_CODES
} from "../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../storage/repository.js";

export class ReencounterFeedbackError extends Error {
  constructor(code, message, retryable, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ReencounterFeedbackError";
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
      Object.values(REENCOUNTER_FEEDBACK_OUTCOMES).includes(value.outcome) &&
      typeof value.feedbackAt === "number" &&
      Number.isFinite(value.feedbackAt) &&
      value.feedbackAt >= 0 &&
      typeof value.updated === "boolean"
  );
}

/**
 * @param {{recordReencounterFeedback: (payload: object) => Promise<unknown>}} repository
 */
export function createReencounterFeedbackUseCase(repository) {
  if (
    !isRecord(repository) ||
    typeof repository.recordReencounterFeedback !== "function"
  ) {
    throw new TypeError(
      "Re-encounter feedback requires Repository.recordReencounterFeedback()."
    );
  }

  return Object.freeze({
    async execute(payload) {
      try {
        const result = await repository.recordReencounterFeedback(payload);
        if (!isResult(result)) {
          throw new TypeError("Repository returned invalid feedback data.");
        }
        return result;
      } catch (error) {
        if (error instanceof RepositoryVersionError) {
          throw new ReencounterFeedbackError(
            RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
            error.message,
            false,
            error
          );
        }
        if (error instanceof RepositoryDataError) {
          const code = error.code === "REENCOUNTER_NOT_FOUND"
            ? RESPONSE_ERROR_CODES.REENCOUNTER_NOT_FOUND
            : RESPONSE_ERROR_CODES.REENCOUNTER_FEEDBACK_CONFLICT;
          throw new ReencounterFeedbackError(code, error.message, false, error);
        }
        throw new ReencounterFeedbackError(
          RESPONSE_ERROR_CODES.STORAGE_ERROR,
          "Unable to persist Re-encounter feedback.",
          true,
          error
        );
      }
    }
  });
}
