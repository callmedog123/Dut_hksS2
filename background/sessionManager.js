// @ts-check

import {
  CONSIDERATION_CLASSIFICATIONS,
  calculateConsideration
} from "./consideration.js";
import { createSessionOwnerKey } from "../storage/repository.js";

export const SESSION_FINALIZATION_CONFIG = Object.freeze({
  leaseDurationMs: 15_000
});

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function createResultId(sessionId, candidateId, owner) {
  const sessionIdentity = owner === undefined || owner === null
    ? encodeURIComponent(sessionId)
    : encodeURIComponent(createSessionOwnerKey(owner));
  return `${sessionIdentity}:${encodeURIComponent(candidateId)}`;
}

function createDefaultLeaseId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `lease-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function hasMeaningfulSignals(session) {
  return Boolean(
    session.candidates.length > 0 &&
      session.candidates.some(({ signals }) =>
        signals.clicked ||
        signals.visibleMs > 0 ||
        signals.hoverMs > 0 ||
        signals.hoverCount > 0 ||
        signals.returnCount > 0
      )
  );
}

function assertRepository(repository) {
  if (typeof repository !== "object" || repository === null) {
    throw new TypeError("Session Manager requires a Repository.");
  }
  for (const method of [
    "getSession",
    "getSessionFinalization",
    "finalizeSessionAtomically",
    "abandonSessionAtomically",
    "claimSessionFinalizationLease",
    "releaseSessionFinalizationLease",
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
 * @param {{leaseIdFactory?: () => string, leaseDurationMs?: number}} [options]
 */
export function createSessionManager(repository, options = {}) {
  assertRepository(repository);
  const leaseIdFactory = options.leaseIdFactory ?? createDefaultLeaseId;
  const leaseDurationMs =
    options.leaseDurationMs ?? SESSION_FINALIZATION_CONFIG.leaseDurationMs;
  if (
    typeof leaseIdFactory !== "function" ||
    !Number.isFinite(leaseDurationMs) ||
    leaseDurationMs <= 0
  ) {
    throw new TypeError("Session Manager lease configuration is invalid.");
  }

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
     * @param {import("../shared/types.js").SessionOwnerV1} [owner]
     * @param {{finalizationLeaseId?: string, abandonIfNoMeaningful?: boolean}} [recoveryOptions]
     */
    async finalizeSession(
      sessionId,
      finalizedAt = Date.now(),
      owner,
      recoveryOptions = {}
    ) {
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
      const finalizationLeaseId =
        recoveryOptions.finalizationLeaseId ?? leaseIdFactory();
      if (
        !isNonEmptyString(finalizationLeaseId) ||
        (recoveryOptions.abandonIfNoMeaningful !== undefined &&
          typeof recoveryOptions.abandonIfNoMeaningful !== "boolean")
      ) {
        throw new TypeError("Session finalization options are invalid.");
      }
      const leaseUntil = finalizedAt + leaseDurationMs;
      if (!Number.isFinite(leaseUntil)) {
        throw new TypeError("Session finalization leaseUntil is invalid.");
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

      const lease = await repository.claimSessionFinalizationLease(
        {
          sessionId,
          finalizationLeaseId,
          claimedAt: finalizedAt,
          leaseUntil
        },
        owner
      );
      if (!lease.acquired) {
        throw new Error(
          `Session finalization lease is unavailable: ${sessionId}`
        );
      }
      try {
        const session = await repository.getSession(sessionId, owner);
        if (session === null) {
          throw new Error(`Session not found: ${sessionId}`);
        }

        if (
          recoveryOptions.abandonIfNoMeaningful === true &&
          !hasMeaningfulSignals(session)
        ) {
          await repository.abandonSessionAtomically(
            {
              sessionId,
              abandonedAt: finalizedAt,
              finalizationLeaseId
            },
            owner
          );
          return {
            sessionId,
            abandonedAt: finalizedAt,
            abandoned: true,
            alreadyFinalized: false,
            chosen: [],
            missedPaths: []
          };
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
            missedPaths,
            finalizationLeaseId
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
      } catch (error) {
        try {
          await repository.releaseSessionFinalizationLease(
            sessionId,
            finalizationLeaseId,
            finalizedAt,
            owner
          );
        } catch {
          // Preserve the settlement error. If this Worker was interrupted, the
          // durable lease can be taken over after leaseUntil.
        }
        throw error;
      }
    }
  });
}
