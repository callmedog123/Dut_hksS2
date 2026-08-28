// @ts-check

import { RESPONSE_ERROR_CODES } from "../shared/messages.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../storage/repository.js";

export class SessionFinalizeError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.name = "SessionFinalizeError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSessionManager(sessionManager) {
  if (
    !isRecord(sessionManager) ||
    typeof sessionManager.finalizeSession !== "function"
  ) {
    throw new TypeError(
      "Session finalization requires SessionManager.finalizeSession()."
    );
  }
}

function isErrorWithMessage(error, pattern) {
  return error instanceof Error && pattern.test(error.message);
}

/**
 * Thin message-facing boundary around the existing Session Manager. Settlement
 * rules and durable idempotence remain owned by Session Manager/Repository.
 *
 * @param {{finalizeSession: (sessionId: string, finalizedAt: number) => Promise<unknown>}} sessionManager
 */
export function createSessionFinalizeUseCase(sessionManager) {
  assertSessionManager(sessionManager);

  return Object.freeze({
    /** @param {{sessionId: string, finalizedAt: number}} payload */
    async execute(payload, owner) {
      try {
        return await sessionManager.finalizeSession(
          payload.sessionId,
          payload.finalizedAt,
          owner
        );
      } catch (error) {
        if (error instanceof RepositoryVersionError) {
          throw new SessionFinalizeError(
            RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
            error.message,
            false
          );
        }
        if (isErrorWithMessage(error, /^Session not found:/u)) {
          throw new SessionFinalizeError(
            RESPONSE_ERROR_CODES.SESSION_NOT_FOUND,
            error.message,
            false
          );
        }
        if (
          error instanceof RepositoryDataError ||
          isErrorWithMessage(error, /^Persisted finalization .* is incomplete\.$/u)
        ) {
          throw new SessionFinalizeError(
            RESPONSE_ERROR_CODES.SESSION_FINALIZE_CONFLICT,
            error.message,
            false
          );
        }
        if (error instanceof TypeError) {
          throw new SessionFinalizeError(
            RESPONSE_ERROR_CODES.SESSION_FINALIZE_FAILED,
            error.message,
            false
          );
        }
        throw new SessionFinalizeError(
          RESPONSE_ERROR_CODES.STORAGE_ERROR,
          "Unable to finalize Session.",
          true
        );
      }
    }
  });
}
