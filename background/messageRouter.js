// @ts-check

import {
  MESSAGE_TYPES,
  RESPONSE_ERROR_CODES,
  SCHEMA_VERSION,
  createErrorResponseMessage,
  createSuccessResponseMessage,
  isCandidatesDiscoveredMessage,
  isCandidatesDiscoveredResponse,
  isMissedPathsQueryMessage,
  isReencounterQueryMessage,
  isSessionFinalizeMessage,
  isSessionFinalizeResponse,
  isSignalsUpdatedMessage,
  isSignalsUpdatedResponse
} from "../shared/messages.js";
import {
  CandidateDiscoveryError,
  createCandidateDiscoveryUseCase
} from "./candidateDiscovery.js";
import {
  ReencounterQueryError,
  createReencounterQueryUseCase
} from "./reencounterQuery.js";
import {
  SignalsUpdateError,
  createSignalsUpdateUseCase
} from "./signalsUpdate.js";
import { SessionFinalizeError } from "./sessionFinalize.js";

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
 *   listReencounters?: () => Promise<unknown[]>,
 *   mergeDiscoveredCandidates?: (payload: object) => Promise<unknown>,
 *   mergeCandidateSignalsSnapshot?: (payload: object) => Promise<unknown>
 * }} repository
 * @param {{
 *   candidateDiscoveryUseCase?: {execute: (payload: object) => Promise<unknown>},
 *   reencounterQueryUseCase?: {execute: (payload: object) => Promise<unknown[]>},
 *   sessionFinalizeUseCase?: {execute: (payload: object) => Promise<unknown>},
 *   signalsUpdateUseCase?: {execute: (payload: object) => Promise<unknown>}
 * }} [options]
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
  const candidateDiscoveryUseCase = options.candidateDiscoveryUseCase ??
    (typeof repository.mergeDiscoveredCandidates === "function"
      ? createCandidateDiscoveryUseCase(repository)
      : null);
  const signalsUpdateUseCase = options.signalsUpdateUseCase ??
    (typeof repository.mergeCandidateSignalsSnapshot === "function"
      ? createSignalsUpdateUseCase(repository)
      : null);
  const sessionFinalizeUseCase = options.sessionFinalizeUseCase ?? null;
  if (
    candidateDiscoveryUseCase !== null &&
    (!isRecord(candidateDiscoveryUseCase) ||
      typeof candidateDiscoveryUseCase.execute !== "function")
  ) {
    throw new TypeError(
      "Message Router Candidate discovery use case must implement execute()."
    );
  }
  if (
    signalsUpdateUseCase !== null &&
    (!isRecord(signalsUpdateUseCase) ||
      typeof signalsUpdateUseCase.execute !== "function")
  ) {
    throw new TypeError(
      "Message Router signals update use case must implement execute()."
    );
  }
  if (
    sessionFinalizeUseCase !== null &&
    (!isRecord(sessionFinalizeUseCase) ||
      typeof sessionFinalizeUseCase.execute !== "function")
  ) {
    throw new TypeError(
      "Message Router Session finalization use case must implement execute()."
    );
  }
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
      const isCandidatesDiscovered =
        message.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED;
      const isSignalsUpdated =
        message.type === MESSAGE_TYPES.SIGNALS_UPDATED;
      const isSessionFinalize =
        message.type === MESSAGE_TYPES.SESSION_FINALIZE;
      if (
        !isMissedPathsQuery &&
        !isReencounterQuery &&
        !isCandidatesDiscovered &&
        !isSignalsUpdated &&
        !isSessionFinalize
      ) {
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
        : isReencounterQuery
          ? isReencounterQueryMessage(message)
          : isCandidatesDiscovered
            ? isCandidatesDiscoveredMessage(message)
            : isSignalsUpdated
              ? isSignalsUpdatedMessage(message)
              : isSessionFinalizeMessage(message);
      if (!isValidRequest) {
        return createRequestError(
          message.requestId,
          RESPONSE_ERROR_CODES.INVALID_REQUEST,
          `Invalid ${String(message.type)} payload.`,
          false
        );
      }

      if (isSessionFinalize) {
        if (sessionFinalizeUseCase === null) {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.SESSION_FINALIZE_FAILED,
            "Session finalization use case is unavailable.",
            false
          );
        }
        try {
          const finalization = await sessionFinalizeUseCase.execute(
            message.payload
          );
          const response = createSuccessResponseMessage(
            message.requestId,
            finalization
          );
          if (!isSessionFinalizeResponse(response)) {
            throw new SessionFinalizeError(
              RESPONSE_ERROR_CODES.SESSION_FINALIZE_FAILED,
              "Session finalization returned invalid data.",
              false
            );
          }
          return response;
        } catch (error) {
          if (error instanceof SessionFinalizeError) {
            return createRequestError(
              message.requestId,
              error.code,
              error.message,
              error.retryable
            );
          }
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.SESSION_FINALIZE_FAILED,
            "Unable to execute Session finalization.",
            false
          );
        }
      }

      if (isSignalsUpdated) {
        if (signalsUpdateUseCase === null) {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.SIGNALS_UPDATE_FAILED,
            "Signals update use case is unavailable.",
            false
          );
        }
        try {
          const update = await signalsUpdateUseCase.execute(message.payload);
          const response = createSuccessResponseMessage(
            message.requestId,
            update
          );
          if (!isSignalsUpdatedResponse(response)) {
            throw new SignalsUpdateError(
              RESPONSE_ERROR_CODES.SIGNALS_UPDATE_FAILED,
              "Signals update returned invalid data.",
              false
            );
          }
          return response;
        } catch (error) {
          if (error instanceof SignalsUpdateError) {
            return createRequestError(
              message.requestId,
              error.code,
              error.message,
              error.retryable
            );
          }
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.SIGNALS_UPDATE_FAILED,
            "Unable to execute signals update.",
            false
          );
        }
      }

      if (isCandidatesDiscovered) {
        if (candidateDiscoveryUseCase === null) {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.CANDIDATE_DISCOVERY_FAILED,
            "Candidate discovery use case is unavailable.",
            false
          );
        }
        try {
          const discovery = await candidateDiscoveryUseCase.execute(
            message.payload
          );
          const response = createSuccessResponseMessage(
            message.requestId,
            discovery
          );
          if (!isCandidatesDiscoveredResponse(response)) {
            throw new CandidateDiscoveryError(
              RESPONSE_ERROR_CODES.CANDIDATE_DISCOVERY_FAILED,
              "Candidate discovery returned invalid data.",
              false
            );
          }
          return response;
        } catch (error) {
          if (error instanceof CandidateDiscoveryError) {
            return createRequestError(
              message.requestId,
              error.code,
              error.message,
              error.retryable
            );
          }
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.CANDIDATE_DISCOVERY_FAILED,
            "Unable to execute Candidate discovery.",
            false
          );
        }
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
