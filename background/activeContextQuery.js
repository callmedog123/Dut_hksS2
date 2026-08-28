// @ts-check

import {
  ACTIVE_CONTEXT_STATUSES,
  RESPONSE_ERROR_CODES
} from "../shared/messages.js";
import { isSearchContextV1 } from "../shared/types.js";

export class ActiveContextQueryError extends Error {
  constructor(message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ActiveContextQueryError";
    this.code = RESPONSE_ERROR_CODES.STORAGE_ERROR;
    this.retryable = true;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRepository(repository) {
  if (
    !isRecord(repository) ||
    typeof repository.getActiveContext !== "function"
  ) {
    throw new TypeError(
      "Active Context query requires Repository.getActiveContext()."
    );
  }
}

/**
 * Read the one durable active-context pointer without modifying Repository
 * state or creating Re-encounter records.
 *
 * @param {{getActiveContext: () => Promise<unknown>}} repository
 */
export function createActiveContextQueryUseCase(repository) {
  assertRepository(repository);

  return Object.freeze({
    async execute() {
      try {
        const activeContext = await repository.getActiveContext();
        if (activeContext === null) {
          return {
            status: ACTIVE_CONTEXT_STATUSES.UNAVAILABLE,
            context: null
          };
        }
        if (
          !isRecord(activeContext) ||
          !isSearchContextV1(activeContext.context)
        ) {
          throw new TypeError("Repository returned invalid active-context data.");
        }
        return {
          status: ACTIVE_CONTEXT_STATUSES.AVAILABLE,
          context: activeContext.context
        };
      } catch (error) {
        throw new ActiveContextQueryError(
          "Unable to query the current SearchContext.",
          error
        );
      }
    }
  });
}
