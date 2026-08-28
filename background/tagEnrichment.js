// @ts-check

import {
  createCandidateTagProfile,
  createContextTagProfile,
  createSessionSelectedTagProfile
} from "../shared/tags.js";
import { normalizeConsiderationSignals } from "./consideration.js";
import { CONSIDERATION_SCORING_CONFIG } from "./scoringConfig.js";

/**
 * The single configuration source for on-demand tag enrichment. These bounds
 * are deliberately independent of the Consideration threshold: passing them
 * only permits a native tag lookup, it never makes a Candidate a Missed Path.
 *
 * Approved "conservative" option. Exposure alone never qualifies, because the
 * exposure feature contributes at most 0.30 and therefore stays below the
 * 0.35 behaviour-score bound. That keeps a grid row of jointly visible cards
 * from triggering native tag requests.
 *
 * These values are not user-test validated.
 */
export const TAG_ENRICHMENT_CONFIG = Object.freeze({
  eligibility: Object.freeze({
    clickedAlwaysQualifies: true,
    minReturnCount: 1,
    minHoverMs: 1_200,
    exposureAloneQualifies: false,
    minBehaviorScore: 0.35
  }),
  limits: Object.freeze({
    maxEnrichedCandidatesPerSession: 12,
    maxAttemptsPerCandidate: 2
  }),
  backoff: Object.freeze({
    baseMs: 5_000,
    factor: 2
  }),
  calibration: Object.freeze({
    validated: false,
    status: "UNVALIDATED_PENDING_5_TO_10_PERSON_TEST",
    targetParticipantRange: "5-10"
  })
});

export const TAG_SOURCES = Object.freeze({
  NATIVE: "NATIVE",
  LOCAL_FALLBACK: "LOCAL_FALLBACK"
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Score the four existing behaviour features only. This reads the frozen
 * Consideration configuration but never changes scoring behaviour.
 *
 * @param {import("../shared/types.js").CandidateSignalsV1} signals
 * @returns {number}
 */
export function calculateTagEnrichmentBehaviorScore(signals) {
  const normalized = normalizeConsiderationSignals(signals);
  const weights = CONSIDERATION_SCORING_CONFIG.weights;
  return (
    normalized.exposure * weights.exposure +
    normalized.hover * weights.hover +
    normalized.returnView * weights.returnView +
    normalized.repeatedHover * weights.repeatedHover
  );
}

/**
 * Decide whether one Candidate may consume a native tag lookup.
 *
 * @param {import("../shared/types.js").CandidateSignalsV1} signals
 * @returns {boolean}
 */
export function isEligibleForTagEnrichment(signals) {
  const { eligibility } = TAG_ENRICHMENT_CONFIG;
  if (signals?.clicked === true && eligibility.clickedAlwaysQualifies) {
    return true;
  }

  const behaviorScore = calculateTagEnrichmentBehaviorScore(signals);
  return Boolean(
    signals.returnCount >= eligibility.minReturnCount ||
      signals.hoverMs >= eligibility.minHoverMs ||
      behaviorScore >= eligibility.minBehaviorScore
  );
}

function assertRepository(repository) {
  if (!isRecord(repository)) {
    throw new TypeError("Tag enrichment requires a Repository.");
  }
  for (const method of [
    "getSession",
    "saveContextTagProfile",
    "saveCandidateTagProfile",
    "getCandidateTagProfile",
    "listCandidateTagProfiles",
    "saveSessionSelectedTagProfile",
    "getSessionSelectedTagProfile"
  ]) {
    if (typeof repository[method] !== "function") {
      throw new TypeError(`Repository must implement ${method}().`);
    }
  }
}

function assertProvider(provider) {
  if (provider === null) {
    return;
  }
  if (!isRecord(provider) || typeof provider.fetchNativeTags !== "function") {
    throw new TypeError(
      "Tag provider must implement fetchNativeTags(candidate)."
    );
  }
}

/**
 * Coordinate on-demand tag enrichment.
 *
 * The provider cache, in-flight coalescing map and failure backoff are
 * intentionally per-Worker-lifetime memory: they are a network optimisation,
 * not business state. Every authoritative tag profile lives in the Repository,
 * so a restarted Worker loses only the cache.
 *
 * @param {object} repository
 * @param {{fetchNativeTags: (candidate: object) => Promise<unknown>} | null} provider
 * @param {{now?: () => number}} [options]
 */
export function createTagEnrichmentCoordinator(
  repository,
  provider = null,
  options = {}
) {
  assertRepository(repository);
  assertProvider(provider);
  const now = options.now ?? Date.now;
  if (typeof now !== "function") {
    throw new TypeError("Tag enrichment now() must be a function.");
  }

  /** @type {Map<string, readonly string[]>} */
  const nativeTagCache = new Map();
  /** @type {Map<string, Promise<readonly string[] | null>>} */
  const inFlightByCandidate = new Map();
  /** @type {Map<string, {attempts: number, nextAttemptAt: number}>} */
  const failureByCandidate = new Map();
  /** @type {Map<string, Set<string>>} */
  const enrichedCandidatesBySession = new Map();

  function cacheKey(sessionKey, candidateId) {
    return `${sessionKey}\u0000${candidateId}`;
  }

  function canAttempt(key) {
    const failure = failureByCandidate.get(key);
    if (failure === undefined) {
      return true;
    }
    return (
      failure.attempts < TAG_ENRICHMENT_CONFIG.limits.maxAttemptsPerCandidate &&
      now() >= failure.nextAttemptAt
    );
  }

  function recordFailure(key) {
    const previous = failureByCandidate.get(key);
    const attempts = (previous?.attempts ?? 0) + 1;
    const delayMs =
      TAG_ENRICHMENT_CONFIG.backoff.baseMs *
      TAG_ENRICHMENT_CONFIG.backoff.factor ** (attempts - 1);
    failureByCandidate.set(key, {
      attempts,
      nextAttemptAt: now() + delayMs
    });
  }

  function reserveSessionSlot(sessionKey, candidateId) {
    let enriched = enrichedCandidatesBySession.get(sessionKey);
    if (enriched === undefined) {
      enriched = new Set();
      enrichedCandidatesBySession.set(sessionKey, enriched);
    }
    if (enriched.has(candidateId)) {
      return true;
    }
    if (
      enriched.size >=
      TAG_ENRICHMENT_CONFIG.limits.maxEnrichedCandidatesPerSession
    ) {
      return false;
    }
    enriched.add(candidateId);
    return true;
  }

  async function requestNativeTags(sessionKey, candidate) {
    const key = cacheKey(sessionKey, candidate.id);
    if (nativeTagCache.has(key)) {
      return nativeTagCache.get(key) ?? null;
    }
    if (provider === null || !canAttempt(key)) {
      return null;
    }

    const pending = inFlightByCandidate.get(key);
    if (pending !== undefined) {
      return pending;
    }

    const operation = (async () => {
      try {
        const nativeTags = await provider.fetchNativeTags(candidate);
        const resolved = Array.isArray(nativeTags) ? nativeTags : [];
        nativeTagCache.set(key, Object.freeze([...resolved]));
        failureByCandidate.delete(key);
        return nativeTagCache.get(key) ?? null;
      } catch {
        // A provider failure must never block settlement. The local fallback
        // from the search query and title is used instead.
        recordFailure(key);
        return null;
      } finally {
        inFlightByCandidate.delete(key);
      }
    })();
    inFlightByCandidate.set(key, operation);
    return operation;
  }

  function sessionKeyFor(sessionId, owner) {
    return owner === undefined || owner === null
      ? `session\u0000${sessionId}`
      : `owner\u0000${owner.tabId}\u0000${owner.documentId}\u0000${owner.frameId}\u0000${sessionId}`;
  }

  return Object.freeze({
    config: TAG_ENRICHMENT_CONFIG,

    /**
     * Persist the local Context tag profile for one Session.
     */
    async recordContextTags(context, owner) {
      const profile = createContextTagProfile({
        sessionId: context.sessionId,
        query: context.query
      });
      await repository.saveContextTagProfile(profile, owner);
      return profile;
    },

    /**
     * Build and persist one Candidate tag profile, requesting native tags only
     * when the approved eligibility bounds are met.
     */
    async enrichCandidate(entry, owner) {
      const { candidate, signals } = entry;
      const sessionKey = sessionKeyFor(candidate.sessionId, owner);
      const eligible = isEligibleForTagEnrichment(signals);
      const existingProfile = await repository.getCandidateTagProfile(
        candidate.sessionId,
        candidate.id,
        owner
      );
      // An empty nativeTags array is a persisted local fallback, not a cached
      // provider success. Keep the candidate eligible for a later lookup when
      // a subsequent signal crosses the approved threshold.
      let nativeTags =
        existingProfile?.nativeTags?.length > 0
          ? existingProfile.nativeTags
          : null;

      if (
        nativeTags === null &&
        eligible &&
        reserveSessionSlot(sessionKey, candidate.id)
      ) {
        nativeTags = await requestNativeTags(sessionKey, candidate);
      }

      const profile = createCandidateTagProfile({
        candidateId: candidate.id,
        sessionId: candidate.sessionId,
        title: candidate.title,
        nativeTags: nativeTags ?? []
      });
      await repository.saveCandidateTagProfile(profile, owner);
      return {
        profile,
        eligible,
        source:
          nativeTags !== null && nativeTags.length > 0
            ? TAG_SOURCES.NATIVE
            : TAG_SOURCES.LOCAL_FALLBACK
      };
    },

    /**
     * Rebuild the Session Selected Tag Profile from the clicked Candidates
     * recorded in the Repository. With no clicked Candidate the profile is
     * persisted as explicitly empty.
     */
    async refreshSelectedTagProfile(sessionId, owner) {
      const session = await repository.getSession(sessionId, owner);
      if (session === null) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const selectedProfiles = [];
      for (const entry of session.candidates) {
        if (!entry.signals.clicked) {
          continue;
        }
        const stored = await repository.getCandidateTagProfile(
          sessionId,
          entry.candidate.id,
          owner
        );
        selectedProfiles.push(
          stored ??
            createCandidateTagProfile({
              candidateId: entry.candidate.id,
              sessionId,
              title: entry.candidate.title
            })
        );
      }

      const profile = createSessionSelectedTagProfile({
        sessionId,
        selectedProfiles
      });
      await repository.saveSessionSelectedTagProfile(profile, owner);
      return profile;
    },

    /**
     * Read the authoritative tag profiles for settlement. Missing records fall
     * back to an explicitly empty selected profile so finalize never blocks.
     */
    async getAuthoritativeTagProfiles(sessionId, owner) {
      const [contextProfile, candidateProfiles, selectedProfile] =
        await Promise.all([
          repository.getContextTagProfile(sessionId, owner),
          repository.listCandidateTagProfiles(sessionId, owner),
          repository.getSessionSelectedTagProfile(sessionId, owner)
        ]);
      return {
        contextProfile,
        candidateProfiles,
        selectedProfile:
          selectedProfile ??
          createSessionSelectedTagProfile({ sessionId, selectedProfiles: [] })
      };
    }
  });
}
