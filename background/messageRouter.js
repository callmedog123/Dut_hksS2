// @ts-check

import {
  MESSAGE_TYPES,
  RESPONSE_ERROR_CODES,
  SCHEMA_VERSION,
  createErrorResponseMessage,
  createSuccessResponseMessage,
  isActiveContextQueryMessage,
  isActiveContextQueryResponse,
  isCandidatesDiscoveredMessage,
  isCandidatesDiscoveredResponse,
  isDataDeleteAllMessage,
  isDataDeleteAllResponse,
  isMissedPathDeleteMessage,
  isMissedPathDeleteResponse,
  isMissedPathsQueryMessage,
  isReencounterFeedbackMessage,
  isReencounterFeedbackResponse,
  isReencounterQueryMessage,
  isReencounterShownMessage,
  isReencounterShownResponse,
  isSessionFinalizeMessage,
  isSessionFinalizeResponse,
  isSettingsUpdateMessage,
  isSettingsUpdateResponse,
  isSignalsUpdatedMessage,
  isSignalsUpdatedResponse
} from "../shared/messages.js";
import { isSettingsV1 } from "../shared/types.js";
import {
  ActiveContextQueryError,
  createActiveContextQueryUseCase
} from "./activeContextQuery.js";
import {
  CandidateDiscoveryError,
  createCandidateDiscoveryUseCase
} from "./candidateDiscovery.js";
import {
  DataDeleteAllError,
  createDataDeleteAllUseCase
} from "./dataDeleteAll.js";
import {
  MissedPathDeleteError,
  createMissedPathDeleteUseCase
} from "./missedPathDelete.js";
import {
  ReencounterFeedbackError,
  createReencounterFeedbackUseCase
} from "./reencounterFeedback.js";
import {
  ReencounterQueryError,
  createReencounterQueryUseCase
} from "./reencounterQuery.js";
import {
  ReencounterShownError,
  createReencounterShownUseCase
} from "./reencounterShown.js";
import {
  SignalsUpdateError,
  createSignalsUpdateUseCase
} from "./signalsUpdate.js";
import { SessionFinalizeError } from "./sessionFinalize.js";
import {
  SettingsUpdateError,
  createSettingsUpdateUseCase
} from "./settingsUpdate.js";

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
 *   deleteMissedPath?: (id: string) => Promise<boolean>,
 *   deleteAll?: () => Promise<boolean>,
 *   getActiveContext?: () => Promise<unknown>,
 *   getSettings?: () => Promise<unknown>,
 *   listReencounters?: () => Promise<unknown[]>,
 *   recordReencounterFeedback?: (payload: object) => Promise<unknown>,
 *   recordReencounterShown?: (payload: object) => Promise<unknown>,
 *   mergeDiscoveredCandidates?: (payload: object) => Promise<unknown>,
 *   mergeCandidateSignalsSnapshot?: (payload: object) => Promise<unknown>
 *   saveSettings?: (settings: object) => Promise<boolean>
 * }} repository
 * @param {{
 *   activeContextQueryUseCase?: {execute: () => Promise<unknown>},
 *   candidateDiscoveryUseCase?: {execute: (payload: object) => Promise<unknown>},
 *   dataDeleteAllUseCase?: {execute: (payload: object) => Promise<unknown>},
 *   missedPathDeleteUseCase?: {execute: (payload: object) => Promise<unknown>},
 *   reencounterQueryUseCase?: {execute: (payload: object) => Promise<unknown[]>},
 *   reencounterFeedbackUseCase?: {execute: (payload: object) => Promise<unknown>},
 *   reencounterShownUseCase?: {execute: (payload: object) => Promise<unknown>},
 *   sessionFinalizeUseCase?: {execute: (payload: object) => Promise<unknown>},
 *   signalsUpdateUseCase?: {execute: (payload: object) => Promise<unknown>}
 *   settingsUpdateUseCase?: {execute: (payload: object) => Promise<unknown>}
 * }} [options]
 */
export function createMessageRouter(repository, options = {}) {
  assertRepository(repository);
  if (!isRecord(options)) {
    throw new TypeError("Message Router options must be an object.");
  }
  const activeContextQueryUseCase = options.activeContextQueryUseCase ??
    (typeof repository.getActiveContext === "function"
      ? createActiveContextQueryUseCase(repository)
      : null);
  const dataDeleteAllUseCase = options.dataDeleteAllUseCase ??
    (typeof repository.deleteAll === "function"
      ? createDataDeleteAllUseCase(repository)
      : null);
  const missedPathDeleteUseCase = options.missedPathDeleteUseCase ??
    (typeof repository.deleteMissedPath === "function"
      ? createMissedPathDeleteUseCase(repository)
      : null);
  const reencounterQueryUseCase = options.reencounterQueryUseCase ??
    (typeof repository.listReencounters === "function"
      ? createReencounterQueryUseCase(repository)
      : null);
  const reencounterFeedbackUseCase = options.reencounterFeedbackUseCase ??
    (typeof repository.recordReencounterFeedback === "function"
      ? createReencounterFeedbackUseCase(repository)
      : null);
  const reencounterShownUseCase = options.reencounterShownUseCase ??
    (typeof repository.recordReencounterShown === "function"
      ? createReencounterShownUseCase(repository)
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
  const settingsUpdateUseCase = options.settingsUpdateUseCase ??
    (typeof repository.getSettings === "function" &&
    typeof repository.saveSettings === "function"
      ? createSettingsUpdateUseCase(repository)
      : null);
  if (
    activeContextQueryUseCase !== null &&
    (!isRecord(activeContextQueryUseCase) ||
      typeof activeContextQueryUseCase.execute !== "function")
  ) {
    throw new TypeError(
      "Message Router Active Context query use case must implement execute()."
    );
  }
  if (
    dataDeleteAllUseCase !== null &&
    (!isRecord(dataDeleteAllUseCase) ||
      typeof dataDeleteAllUseCase.execute !== "function")
  ) {
    throw new TypeError(
      "Message Router data delete all use case must implement execute()."
    );
  }
  if (
    missedPathDeleteUseCase !== null &&
    (!isRecord(missedPathDeleteUseCase) ||
      typeof missedPathDeleteUseCase.execute !== "function")
  ) {
    throw new TypeError(
      "Message Router Missed Path delete use case must implement execute()."
    );
  }
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
    settingsUpdateUseCase !== null &&
    (!isRecord(settingsUpdateUseCase) ||
      typeof settingsUpdateUseCase.execute !== "function")
  ) {
    throw new TypeError(
      "Message Router Settings update use case must implement execute()."
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
  if (
    reencounterFeedbackUseCase !== null &&
    (!isRecord(reencounterFeedbackUseCase) ||
      typeof reencounterFeedbackUseCase.execute !== "function")
  ) {
    throw new TypeError(
      "Message Router Re-encounter feedback use case must implement execute()."
    );
  }
  if (
    reencounterShownUseCase !== null &&
    (!isRecord(reencounterShownUseCase) ||
      typeof reencounterShownUseCase.execute !== "function")
  ) {
    throw new TypeError(
      "Message Router Re-encounter shown use case must implement execute()."
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
      const isActiveContextQuery =
        message.type === MESSAGE_TYPES.ACTIVE_CONTEXT_QUERY;
      const isDataDeleteAll =
        message.type === MESSAGE_TYPES.DATA_DELETE_ALL;
      const isMissedPathsQuery =
        message.type === MESSAGE_TYPES.MISSED_PATHS_QUERY;
      const isMissedPathDelete =
        message.type === MESSAGE_TYPES.MISSED_PATH_DELETE;
      const isReencounterQuery =
        message.type === MESSAGE_TYPES.RE_ENCOUNTER_QUERY;
      const isReencounterFeedback =
        message.type === MESSAGE_TYPES.RE_ENCOUNTER_FEEDBACK;
      const isReencounterShown =
        message.type === MESSAGE_TYPES.RE_ENCOUNTER_SHOWN;
      const isCandidatesDiscovered =
        message.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED;
      const isSignalsUpdated =
        message.type === MESSAGE_TYPES.SIGNALS_UPDATED;
      const isSessionFinalize =
        message.type === MESSAGE_TYPES.SESSION_FINALIZE;
      const isSettingsUpdate =
        message.type === MESSAGE_TYPES.SETTINGS_UPDATE;
      if (
        !isActiveContextQuery &&
        !isDataDeleteAll &&
        !isMissedPathDelete &&
        !isMissedPathsQuery &&
        !isReencounterQuery &&
        !isReencounterFeedback &&
        !isReencounterShown &&
        !isCandidatesDiscovered &&
        !isSignalsUpdated &&
        !isSessionFinalize &&
        !isSettingsUpdate
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
      const isValidRequest = isActiveContextQuery
        ? isActiveContextQueryMessage(message)
        : isDataDeleteAll
          ? isDataDeleteAllMessage(message)
          : isMissedPathDelete
            ? isMissedPathDeleteMessage(message)
            : isMissedPathsQuery
              ? isMissedPathsQueryMessage(message)
              : isReencounterQuery
                ? isReencounterQueryMessage(message)
                : isReencounterFeedback
                  ? isReencounterFeedbackMessage(message)
                  : isReencounterShown
                    ? isReencounterShownMessage(message)
                    : isCandidatesDiscovered
                      ? isCandidatesDiscoveredMessage(message)
                      : isSignalsUpdated
                        ? isSignalsUpdatedMessage(message)
                        : isSessionFinalize
                          ? isSessionFinalizeMessage(message)
                          : isSettingsUpdateMessage(message);
      if (!isValidRequest) {
        return createRequestError(
          message.requestId,
          RESPONSE_ERROR_CODES.INVALID_REQUEST,
          `Invalid ${String(message.type)} payload.`,
          false
        );
      }

      if (isActiveContextQuery) {
        if (activeContextQueryUseCase === null) {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.STORAGE_ERROR,
            "Active Context query is unavailable.",
            true
          );
        }
        try {
          const activeContext = await activeContextQueryUseCase.execute();
          const response = createSuccessResponseMessage(
            message.requestId,
            activeContext
          );
          if (!isActiveContextQueryResponse(response)) {
            throw new ActiveContextQueryError(
              "Active Context query returned invalid data."
            );
          }
          return response;
        } catch (error) {
          if (error instanceof ActiveContextQueryError) {
            return createRequestError(
              message.requestId,
              error.code,
              error.message,
              error.retryable
            );
          }
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.STORAGE_ERROR,
            "Unable to query the current SearchContext.",
            true
          );
        }
      }

      if (isDataDeleteAll) {
        if (dataDeleteAllUseCase === null) {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.DATA_DELETE_ALL_FAILED,
            "Data delete all use case is unavailable.",
            false
          );
        }
        try {
          const result = await dataDeleteAllUseCase.execute(message.payload);
          const response = createSuccessResponseMessage(
            message.requestId,
            result
          );
          if (!isDataDeleteAllResponse(response)) {
            throw new DataDeleteAllError(
              RESPONSE_ERROR_CODES.DATA_DELETE_ALL_FAILED,
              "Data delete all returned invalid data.",
              false
            );
          }
          return response;
        } catch (error) {
          if (error instanceof DataDeleteAllError) {
            return createRequestError(
              message.requestId,
              error.code,
              error.message,
              error.retryable
            );
          }
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.DATA_DELETE_ALL_FAILED,
            "Unable to execute data delete all.",
            false
          );
        }
      }

      if (isMissedPathDelete) {
        if (missedPathDeleteUseCase === null) {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.MISSED_PATH_DELETE_FAILED,
            "Missed Path delete use case is unavailable.",
            false
          );
        }
        try {
          const result = await missedPathDeleteUseCase.execute(message.payload);
          const response = createSuccessResponseMessage(
            message.requestId,
            result
          );
          if (!isMissedPathDeleteResponse(response)) {
            throw new MissedPathDeleteError(
              RESPONSE_ERROR_CODES.MISSED_PATH_DELETE_FAILED,
              "Missed Path delete returned invalid data.",
              false
            );
          }
          return response;
        } catch (error) {
          if (error instanceof MissedPathDeleteError) {
            return createRequestError(
              message.requestId,
              error.code,
              error.message,
              error.retryable
            );
          }
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.MISSED_PATH_DELETE_FAILED,
            "Unable to execute Missed Path delete.",
            false
          );
        }
      }

      if (isSettingsUpdate) {
        if (settingsUpdateUseCase === null) {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.SETTINGS_UPDATE_FAILED,
            "Settings update use case is unavailable.",
            false
          );
        }
        try {
          const result = await settingsUpdateUseCase.execute(message.payload);
          const response = createSuccessResponseMessage(
            message.requestId,
            result
          );
          if (!isSettingsUpdateResponse(response)) {
            throw new SettingsUpdateError(
              RESPONSE_ERROR_CODES.SETTINGS_UPDATE_FAILED,
              "Settings update returned invalid data.",
              false
            );
          }
          return response;
        } catch (error) {
          if (error instanceof SettingsUpdateError) {
            return createRequestError(
              message.requestId,
              error.code,
              error.message,
              error.retryable
            );
          }
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.SETTINGS_UPDATE_FAILED,
            "Unable to execute Settings update.",
            false
          );
        }
      }

      if (
        (isCandidatesDiscovered || isSignalsUpdated || isSessionFinalize) &&
        typeof repository.getSettings === "function"
      ) {
        try {
          const settings = await repository.getSettings();
          if (!isSettingsV1(settings)) {
            throw new TypeError("Repository returned invalid Settings data.");
          }
          if (!settings.enabled) {
            return createRequestError(
              message.requestId,
              RESPONSE_ERROR_CODES.COLLECTION_PAUSED,
              "Collection is paused in Settings.",
              false
            );
          }
        } catch {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.STORAGE_ERROR,
            "Unable to read collection Settings.",
            true
          );
        }
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

      if (isReencounterFeedback) {
        if (reencounterFeedbackUseCase === null) {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.REENCOUNTER_FEEDBACK_FAILED,
            "Re-encounter feedback use case is unavailable.",
            false
          );
        }
        try {
          const feedback = await reencounterFeedbackUseCase.execute(
            message.payload
          );
          const response = createSuccessResponseMessage(
            message.requestId,
            feedback
          );
          if (!isReencounterFeedbackResponse(response)) {
            throw new ReencounterFeedbackError(
              RESPONSE_ERROR_CODES.REENCOUNTER_FEEDBACK_FAILED,
              "Re-encounter feedback returned invalid data.",
              false
            );
          }
          return response;
        } catch (error) {
          if (error instanceof ReencounterFeedbackError) {
            return createRequestError(
              message.requestId,
              error.code,
              error.message,
              error.retryable
            );
          }
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.REENCOUNTER_FEEDBACK_FAILED,
            "Unable to execute Re-encounter feedback.",
            false
          );
        }
      }

      if (isReencounterShown) {
        if (reencounterShownUseCase === null) {
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.REENCOUNTER_SHOWN_FAILED,
            "Re-encounter shown use case is unavailable.",
            false
          );
        }
        try {
          const shown = await reencounterShownUseCase.execute(message.payload);
          const response = createSuccessResponseMessage(
            message.requestId,
            shown
          );
          if (!isReencounterShownResponse(response)) {
            throw new ReencounterShownError(
              RESPONSE_ERROR_CODES.REENCOUNTER_SHOWN_FAILED,
              "Re-encounter shown returned invalid data.",
              false
            );
          }
          return response;
        } catch (error) {
          if (error instanceof ReencounterShownError) {
            return createRequestError(
              message.requestId,
              error.code,
              error.message,
              error.retryable
            );
          }
          return createRequestError(
            message.requestId,
            RESPONSE_ERROR_CODES.REENCOUNTER_SHOWN_FAILED,
            "Unable to execute Re-encounter shown.",
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
