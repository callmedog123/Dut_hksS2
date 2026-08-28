// @ts-check

import {
  CONSIDERATION_CLASSIFICATIONS,
  calculateConsideration
} from "./consideration.js";
import { createSessionOwnerKey } from "../storage/repository.js";

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function createResultId(sessionId, candidateId, owner) {
  const sessionIdentity = owner === undefined || owner === null
    ? encodeURIComponent(sessionId)
    : encodeURIComponent(createSessionOwnerKey(owner));
  return `${sessionIdentity}:${encodeURIComponent(candidateId)}`;
}

function assertRepository(repository) {
  if (typeof repository !== "object" || repository === null) {
    throw new TypeError("Session Manager requires a Repository.");
  }
  for (const method of [
    "getSession",
    "getSessionFinalization",
    "finalizeSessionAtomically",
    "markCandidateChosen",
    "getChosen",
    "getMissedPath"
  ]) {
    if (typeof repository[method] !== "function") {
      throw new TypeError(`Repository must implement ${method}().`);
    }
  }
}

async function loadFinalizedRecords(repository, marker) {
  const chosen = await Promise.all(
    marker.chosenIds.map((id) => repository.getChosen(id))
  );
  const missedPaths = await Promise.all(
    marker.missedPathIds.map((id) => repository.getMissedPath(id))
  );
  if (
    chosen.some((record) => record === null) ||
    missedPaths.some((record) => record === null)
  ) {
    throw new Error(
      `Persisted finalization for session ${marker.sessionId} is incomplete.`
    );
  }
  return { chosen, missedPaths };
}

/**
 * Create the one-shot session settlement coordinator. All idempotence state is
 * read from the Repository so a new Service Worker instance reaches the same
 * result without relying on memory.
 *
 * @param {ReturnType<typeof import("../storage/repository.js").createRepository>} repository
 */
export function createSessionManager(repository) {
  assertRepository(repository);

  return Object.freeze({
    /**
     * Persist the existing CANDIDATE_CHOSEN signal before settlement. No
     * business state is cached here, so a new Worker instance reads the same
     * clicked flag from the Repository.
     *
     * @param {string} sessionId
     * @param {string} candidateId
     * @param {number} chosenAt
     */
    async recordCandidateChosen(sessionId, candidateId, chosenAt, owner) {
      if (!isNonEmptyString(sessionId) || !isNonEmptyString(candidateId)) {
        throw new TypeError(
          "sessionId and candidateId must be non-empty strings."
        );
      }
      if (
        typeof chosenAt !== "number" ||
        !Number.isFinite(chosenAt) ||
        chosenAt < 0
      ) {
        throw new TypeError("chosenAt must be a finite non-negative number.");
      }

      const updated = await repository.markCandidateChosen(
        sessionId,
        candidateId,
        chosenAt,
        owner
      );
      return { sessionId, candidateId, updated };
    },

    /**
     * Settle one already-persisted aggregate session.
     *
     * @param {string} sessionId
     * @param {number} [finalizedAt]
     */
    async finalizeSession(sessionId, finalizedAt = Date.now(), owner) {
      if (!isNonEmptyString(sessionId)) {
        throw new TypeError("sessionId must be a non-empty string.");
      }
      if (
        typeof finalizedAt !== "number" ||
        !Number.isFinite(finalizedAt) ||
        finalizedAt < 0
      ) {
        throw new TypeError("finalizedAt must be a finite non-negative number.");
      }

      const existingMarker =
        await repository.getSessionFinalization(sessionId, owner);
      if (existingMarker !== null) {
        const records = await loadFinalizedRecords(repository, existingMarker);
        return {
          sessionId,
          finalizedAt: existingMarker.finalizedAt,
          alreadyFinalized: true,
          ...records
        };
      }

      const session = await repository.getSession(sessionId, owner);
      if (session === null) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const chosen = [];
      const missedPaths = [];
      for (const entry of session.candidates) {
        const consideration = calculateConsideration(entry.signals);
        const id = createResultId(sessionId, entry.candidate.id, owner);

        if (entry.signals.clicked) {
          chosen.push({
            id,
            candidate: entry.candidate,
            context: session.context,
            chosenAt: finalizedAt
          });
          continue;
        }

        if (
          consideration.classification ===
          CONSIDERATION_CLASSIFICATIONS.QUALIFIES
        ) {
          missedPaths.push({
            id,
            candidate: entry.candidate,
            context: session.context,
            score: consideration.score,
            reasons: consideration.reasons,
            status: "MISSED",
            createdAt: finalizedAt
          });
        }
      }

      const persisted = await repository.finalizeSessionAtomically(
        {
          sessionId,
          finalizedAt,
          chosen,
          missedPaths
        },
        owner
      );
      if (!persisted.created) {
        const records = await loadFinalizedRecords(
          repository,
          persisted.finalization
        );
        return {
          sessionId,
          finalizedAt: persisted.finalization.finalizedAt,
          alreadyFinalized: true,
          ...records
        };
      }

      return {
        sessionId,
        finalizedAt,
        alreadyFinalized: false,
        chosen,
        missedPaths
      };
    }
  });
}
