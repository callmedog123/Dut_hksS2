// @ts-check

import { rankReencounters } from "./reencounter.js";
import {
  isSearchContextV1,
  isSessionOwnerV1
} from "../shared/types.js";

export const REENCOUNTER_QUERY_FAILURE_CODES = Object.freeze({
  BUSINESS: "REENCOUNTER_QUERY_FAILED",
  STORAGE: "STORAGE_ERROR"
});

export class ReencounterQueryError extends Error {
  constructor(code, message, retryable, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ReencounterQueryError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRepository(repository) {
  if (!isRecord(repository)) {
    throw new TypeError("Re-encounter query requires a Repository.");
  }
  for (const method of ["listMissedPaths", "listReencounters"]) {
    if (typeof repository[method] !== "function") {
      throw new TypeError(`Repository must implement ${method}().`);
    }
  }
}

function supportsTagProfileReads(repository) {
  return [
    "getActiveContextForTab",
    "getContextTagProfile",
    "getSessionSelectedTagProfile",
    "getCandidateTagProfileForMissedPath"
  ].every((method) => typeof repository[method] === "function");
}

function isSameContext(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function aggregateHistory(missedPaths, reencounters, candidateProfiles = []) {
  if (
    !Array.isArray(candidateProfiles) ||
    (candidateProfiles.length !== 0 &&
      candidateProfiles.length !== missedPaths.length)
  ) {
    throw new TypeError("Candidate tag profile results are misaligned.");
  }
  const historyByMissedPathId = new Map();
  for (const reencounter of reencounters) {
    if (
      !isRecord(reencounter) ||
      typeof reencounter.missedPathId !== "string" ||
      reencounter.missedPathId.length === 0 ||
      typeof reencounter.shownAt !== "number" ||
      !Number.isFinite(reencounter.shownAt) ||
      reencounter.shownAt < 0 ||
      (Object.hasOwn(reencounter, "feedbackAt") &&
        (typeof reencounter.feedbackAt !== "number" ||
          !Number.isFinite(reencounter.feedbackAt) ||
          reencounter.feedbackAt < 0))
    ) {
      throw new TypeError("Repository returned invalid Re-encounter history.");
    }

    const history = historyByMissedPathId.get(reencounter.missedPathId) ?? {
      lastShownAt: null,
      dismissalCount: 0
    };
    const effectiveShownAt =
      reencounter.outcome === "LATER" &&
      Object.hasOwn(reencounter, "feedbackAt")
        ? Math.max(reencounter.shownAt, reencounter.feedbackAt)
        : reencounter.shownAt;
    history.lastShownAt =
      history.lastShownAt === null
        ? effectiveShownAt
        : Math.max(history.lastShownAt, effectiveShownAt);
    if (
      reencounter.outcome === "DISMISSED" ||
      reencounter.outcome === "NOT_RELEVANT"
    ) {
      history.dismissalCount += 1;
    }
    historyByMissedPathId.set(reencounter.missedPathId, history);
  }

  return missedPaths.map((missedPath, index) => ({
    missedPath,
    candidateTagProfile: candidateProfiles[index] ?? null,
    ...(historyByMissedPathId.get(missedPath.id) ?? {
      lastShownAt: null,
      dismissalCount: 0
    })
  }));
}

/**
 * Read-only use case for the current contextual Re-encounter candidates.
 * Repeated calls do not create or update records.
 *
 * @param {{
 *   listMissedPaths: () => Promise<unknown[]>,
 *   listReencounters: () => Promise<unknown[]>,
 *   getActiveContextForTab?: (tabId: number) => Promise<unknown>,
 *   getContextTagProfile?: (sessionId: string, owner: object) => Promise<unknown>,
 *   getSessionSelectedTagProfile?: (sessionId: string, owner: object) => Promise<unknown>,
 *   getCandidateTagProfileForMissedPath?: (missedPathId: string) => Promise<unknown>
 * }} repository
 * @param {{ranker?: typeof rankReencounters}} [options]
 */
export function createReencounterQueryUseCase(repository, options = {}) {
  assertRepository(repository);
  if (!isRecord(options)) {
    throw new TypeError("Re-encounter query options must be an object.");
  }
  const ranker = options.ranker ?? rankReencounters;
  if (typeof ranker !== "function") {
    throw new TypeError("Re-encounter query ranker must be a function.");
  }

  return Object.freeze({
    /**
     * @param {{
     *   context: import("../shared/types.js").SearchContextV1,
     *   limit: number
     * }} payload
     */
    async execute(payload, activeTabId) {
      let missedPaths;
      let reencounters;
      let candidateProfiles = [];
      let contextTagProfile = null;
      let sessionSelectedTagProfile = null;
      try {
        [missedPaths, reencounters] = await Promise.all([
          repository.listMissedPaths(),
          repository.listReencounters()
        ]);
        if (!Array.isArray(missedPaths) || !Array.isArray(reencounters)) {
          throw new TypeError("Repository query results must be arrays.");
        }

        if (
          supportsTagProfileReads(repository) &&
          Number.isInteger(activeTabId) &&
          activeTabId >= 0
        ) {
          const activeContext = await repository.getActiveContextForTab(
            activeTabId
          );
          if (
            activeContext !== null &&
            isRecord(activeContext) &&
            isSearchContextV1(activeContext.context) &&
            isSessionOwnerV1(activeContext.owner) &&
            activeContext.sessionId === activeContext.owner.sessionId &&
            isSameContext(activeContext.context, payload.context)
          ) {
            [
              contextTagProfile,
              sessionSelectedTagProfile,
              candidateProfiles
            ] = await Promise.all([
              repository.getContextTagProfile(
                activeContext.sessionId,
                activeContext.owner
              ),
              repository.getSessionSelectedTagProfile(
                activeContext.sessionId,
                activeContext.owner
              ),
              Promise.all(
                missedPaths.map((missedPath) =>
                  repository.getCandidateTagProfileForMissedPath(
                    missedPath.id
                  )
                )
              )
            ]);
          }
        }
      } catch (error) {
        throw new ReencounterQueryError(
          REENCOUNTER_QUERY_FAILURE_CODES.STORAGE,
          "Unable to query local Re-encounter data.",
          true,
          error
        );
      }

      try {
        const entries = aggregateHistory(
          missedPaths,
          reencounters,
          candidateProfiles
        );
        return ranker(entries, payload.context, {
          limit: payload.limit,
          contextTagProfile,
          sessionSelectedTagProfile
        });
      } catch (error) {
        throw new ReencounterQueryError(
          REENCOUNTER_QUERY_FAILURE_CODES.BUSINESS,
          "Unable to rank Re-encounter candidates.",
          false,
          error
        );
      }
    }
  });
}
