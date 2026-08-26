// @ts-check

import { rankReencounters } from "./reencounter.js";

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

function aggregateHistory(missedPaths, reencounters) {
  const historyByMissedPathId = new Map();
  for (const reencounter of reencounters) {
    if (
      !isRecord(reencounter) ||
      typeof reencounter.missedPathId !== "string" ||
      reencounter.missedPathId.length === 0 ||
      typeof reencounter.shownAt !== "number" ||
      !Number.isFinite(reencounter.shownAt) ||
      reencounter.shownAt < 0
    ) {
      throw new TypeError("Repository returned invalid Re-encounter history.");
    }

    const history = historyByMissedPathId.get(reencounter.missedPathId) ?? {
      lastShownAt: null,
      dismissalCount: 0
    };
    history.lastShownAt =
      history.lastShownAt === null
        ? reencounter.shownAt
        : Math.max(history.lastShownAt, reencounter.shownAt);
    if (reencounter.outcome === "DISMISSED") {
      history.dismissalCount += 1;
    }
    historyByMissedPathId.set(reencounter.missedPathId, history);
  }

  return missedPaths.map((missedPath) => ({
    missedPath,
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
 *   listReencounters: () => Promise<unknown[]>
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
    async execute(payload) {
      let missedPaths;
      let reencounters;
      try {
        [missedPaths, reencounters] = await Promise.all([
          repository.listMissedPaths(),
          repository.listReencounters()
        ]);
        if (!Array.isArray(missedPaths) || !Array.isArray(reencounters)) {
          throw new TypeError("Repository query results must be arrays.");
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
        const entries = aggregateHistory(missedPaths, reencounters);
        return ranker(entries, payload.context, { limit: payload.limit });
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
