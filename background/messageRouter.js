// @ts-check

import {
  MESSAGE_TYPES,
  RESPONSE_ERROR_CODES,
  SCHEMA_VERSION,
  createErrorResponseMessage,
  createSuccessResponseMessage,
  isMissedPathsQueryMessage,
  isReencounterQueryMessage
} from "../shared/messages.js";
import {
  ReencounterQueryError,
  createReencounterQueryUseCase
} from "./reencounterQuery.js";

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function assertRepository(repository) {
  if (
    !isRecord(repository) ||
    typeof repository.listMissedPaths !== "function"
  ) {
    throw new TypeError("Message Router requires Repository.listMissedPaths().");
  }
}

function createRequestError(requestId, code, message, retryable) {
  return createErrorResponseMessage(requestId, {
    code,
    message,
    retryable
  });
}

/**
 * Router for the single currently implemented Side Panel business query.
 * Other message types remain owned by their existing handlers.
 *
 * @param {{
 *   listMissedPaths: () => Promise<unknown[]>,
 *   listReencounters?: () => Promise<unknown[]>
 * }} repository
 * @param {{reencounterQueryUseCase?: {execute: (payload: object) => Promise<unknown[]>}}} [options]
 */
export function createMessageRouter(repository, options = {}) {
  assertRepository(repository);
  if (!isRecord(options)) {
    throw new TypeError("Message Router options must be an object.");
  }
  const reencounterQueryUseCase = options.reencounterQueryUseCase ??
    (typeof repository.listReencounters === "function"
      ? createReencounterQueryUseCase(repository)
      : null);
  if (
    reencounterQueryUseCase !== null &&
    (!isRecord(reencounterQueryUseCase) ||
      typeof reencounterQueryUseCase.execute !== "function")
  ) {
    throw new TypeError(
      "Message Router Re-encounter query use case must implement execute()."
    );
  }

  return Object.freeze({
    /**
     * @param {unknown} message
     * @returns {Promise<import("../shared/messages.js").ResponseMessage<unknown> | null>}
     */
    async route(message) {
      if (!isRecord(message)) {
        return null;
      }
      const isMissedPathsQuery =
        message.type === MESSAGE_TYPES.MISSED_PATHS_QUERY;
      const isReencounterQuery =
        message.type === MESSAGE_TYPES.RE_ENCOUNTER_QUERY;
      if (!isMissedPathsQuery && !isReencounterQuery) {
        return null;
      }
      if (!isNonEmptyString(message.requestId)) {
        return null;
      }
      if (message.schemaVersion !== SCHEMA_VERSION) {
        return createRequestError(
          message.requestId,
          RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
          `Unsupported schemaVersion: ${String(message.schemaVersion)}.`,
          false
        );
      }
      const isValidRequest = isMissedPathsQuery
        ? isMissedPathsQueryMessage(message)
        : isReencounterQueryMessage(message);
      if (!isValidRequest) {
        return createRequestError(
          message.requestId,
          RESPONSE_ERROR_CODES.INVALID_REQUEST,
          `Invalid ${String(message.type)} payload.`,
          false
        );
      }

      if (isReencounterQuery) {
        if (reencounterQueryUseCase === null) {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.REENCOUNTER_QUERY_FAILED,
            "Re-encounter query use case is unavailable.",
            false
          );
        }
        try {
          const reencounters = await reencounterQueryUseCase.execute(
            message.payload
          );
          if (!Array.isArray(reencounters)) {
            throw new ReencounterQueryError(
              RESPONSE_ERROR_CODES.REENCOUNTER_QUERY_FAILED,
              "Re-encounter query returned invalid data.",
              false
            );
          }
          return createSuccessResponseMessage(message.requestId, {
            reencounters
          });
        } catch (error) {
          if (error instanceof ReencounterQueryError) {
            return createRequestError(
              message.requestId,
              error.code,
              error.message,
              error.retryable
            );
          }
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.REENCOUNTER_QUERY_FAILED,
            "Unable to execute Re-encounter query.",
            false
          );
        }
      }

      try {
        const missedPaths = await repository.listMissedPaths();
        if (!Array.isArray(missedPaths)) {
          throw new TypeError("Repository returned invalid MissedPath data.");
        }
        return createSuccessResponseMessage(message.requestId, {
          missedPaths
        });
      } catch {
        return createRequestError(
          message.requestId,
          RESPONSE_ERROR_CODES.STORAGE_ERROR,
          "Unable to query local Missed Paths.",
          true
        );
      }
    }
  });
}
