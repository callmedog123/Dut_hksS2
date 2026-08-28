// @ts-check

import { RESPONSE_ERROR_CODES } from "../shared/messages.js";
import { createCandidateTagProfile } from "../shared/tags.js";
import {
  RepositoryDataError,
  RepositoryVersionError
} from "../storage/repository.js";
import { SESSION_LIFECYCLE_STATUSES } from "../shared/types.js";

export class CandidateTagsUpdateError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.name = "CandidateTagsUpdateError";
    this.code = code;
    this.retryable = retryable;
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRepository(repository) {
  if (!isRecord(repository)) {
    throw new TypeError("Candidate tags update requires a Repository.");
  }
  for (const method of [
    "getSession",
    "getSessionFinalization",
    "saveCandidateTagProfile"
  ]) {
    if (typeof repository[method] !== "function") {
      throw new TypeError(`Repository must implement ${method}().`);
    }
  }
}

/**
 * Persist platform-native tags that a Site Adapter read from visible page DOM.
 *
 * The Candidate title always comes from the Repository, never from the message,
 * so a page cannot inject a different title through this channel. Candidate IDs
 * that are not part of the owned Session are rejected rather than stored.
 *
 * This channel performs no network access, so the Task 8 enrichment threshold
 * does not apply: that bound governs provider/network calls, while these tags
 * were already visible in the page the user was looking at.
 *
 * @param {object} repository
 */
export function createCandidateTagsUpdateUseCase(repository) {
  assertRepository(repository);

  return Object.freeze({
    /**
     * @param {{sessionId: string, tags: readonly object[], discoveredAt: number}} payload
     * @param {import("../shared/types.js").SessionOwnerV1} [owner]
     */
    async execute(payload, owner) {
      try {
        const finalization = await repository.getSessionFinalization(
          payload.sessionId,
          owner
        );
        if (finalization !== null) {
          // A late batch arriving after settlement must not mutate the tag
          // profiles the finalized result was derived from.
          throw new CandidateTagsUpdateError(
            RESPONSE_ERROR_CODES.CANDIDATE_TAGS_CONFLICT,
            `Cannot update tags for finalized session: ${payload.sessionId}`,
            false
          );
        }

        const session = await repository.getSession(payload.sessionId, owner);
        if (session === null) {
          throw new CandidateTagsUpdateError(
            RESPONSE_ERROR_CODES.SESSION_NOT_FOUND,
            `Session not found: ${payload.sessionId}`,
            false
          );
        }
        const status = session.status ?? SESSION_LIFECYCLE_STATUSES.OPEN;
        if (status !== SESSION_LIFECYCLE_STATUSES.OPEN) {
          throw new CandidateTagsUpdateError(
            RESPONSE_ERROR_CODES.CANDIDATE_TAGS_CONFLICT,
            `Cannot update tags for session in ${status} state.`,
            false
          );
        }

        const titlesByCandidateId = new Map(
          session.candidates.map((entry) => [
            entry.candidate.id,
            entry.candidate.title
          ])
        );
        const acceptedCandidateIds = [];
        for (const entry of payload.tags) {
          const title = titlesByCandidateId.get(entry.candidateId);
          if (title === undefined) {
            throw new CandidateTagsUpdateError(
              RESPONSE_ERROR_CODES.CANDIDATE_TAGS_CONFLICT,
              `Candidate ${entry.candidateId} is not part of session ${payload.sessionId}.`,
              false
            );
          }

          const profile = createCandidateTagProfile({
            candidateId: entry.candidateId,
            sessionId: payload.sessionId,
            title,
            nativeTags: entry.nativeTags
          });
          await repository.saveCandidateTagProfile(profile, owner);
          acceptedCandidateIds.push(entry.candidateId);
        }

        return {
          sessionId: payload.sessionId,
          acceptedCandidateIds,
          storedCandidateCount: acceptedCandidateIds.length
        };
      } catch (error) {
        if (error instanceof CandidateTagsUpdateError) {
          throw error;
        }
        if (error instanceof RepositoryVersionError) {
          throw new CandidateTagsUpdateError(
            RESPONSE_ERROR_CODES.SCHEMA_VERSION_UNSUPPORTED,
            error.message,
            false
          );
        }
        if (error instanceof RepositoryDataError) {
          throw new CandidateTagsUpdateError(
            RESPONSE_ERROR_CODES.CANDIDATE_TAGS_CONFLICT,
            error.message,
            false
          );
        }
        throw new CandidateTagsUpdateError(
          RESPONSE_ERROR_CODES.STORAGE_ERROR,
          "Unable to persist Candidate native tags.",
          true
        );
      }
    }
  });
}
