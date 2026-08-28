// @ts-check

import { PLATFORMS, CONTENT_TYPES, LAYOUT_TYPES, resolvePlatformFromSource } from "../shared/types.js";

/**
 * Consideration Score v2 configuration (frozen 2026-08-29, Task 10 approval).
 * These values are not user-test validated.
 */
export const CONSIDERATION_SCORING_CONFIG = Object.freeze({
  weights: Object.freeze({
    exposure: 0.30,
    hover: 0.30,
    returnView: 0.25,
    repeatedHover: 0.15,
    selectedTagSimilarity: 0.15
  }),
  /**
   * The minimum behavior score required before a Candidate can qualify as a
   * Missed Path. Tag bonus cannot bypass this floor.
   */
  minimumBehaviorThreshold: 0.35,
  /**
   * The total score threshold (behavior + tag bonus).
   */
  threshold: 0.55,
  /**
   * Platform- and layout-specific normalization caps. When contentType or
   * layoutType is absent (legacy v2 records), fall back to the platform default.
   * When platform is UNKNOWN, use the BILIBILI/GRID caps as the safe default.
   */
  normalizationCapsByPlatform: Object.freeze({
    [PLATFORMS.BILIBILI]: Object.freeze({
      [LAYOUT_TYPES.GRID]: Object.freeze({
        exposureMs: 10_000,
        hoverMs: 3_000,
        returnCount: 2,
        repeatedHoverCount: 3
      })
    }),
    [PLATFORMS.ZHIHU]: Object.freeze({
      [LAYOUT_TYPES.TEXT_LIST]: Object.freeze({
        exposureMs: 15_000,
        hoverMs: 5_000,
        returnCount: 3,
        repeatedHoverCount: 4
      })
    }),
    [PLATFORMS.DOUYIN]: Object.freeze({
      [LAYOUT_TYPES.VIDEO_FEED]: Object.freeze({
        exposureMs: 8_000,
        hoverMs: 2_000,
        returnCount: 2,
        repeatedHoverCount: 3
      })
    })
  }),
  calibration: Object.freeze({
    validated: false,
    status: "UNVALIDATED_PENDING_5_TO_10_PERSON_TEST",
    targetParticipantRange: "5-10"
  })
});

/**
 * Resolve normalization caps for a Candidate based on platform/contentType/layout.
 * Falls back to BILIBILI/GRID when any dimension is missing or unknown.
 *
 * @param {import("../shared/types.js").CandidateV1} candidate
 * @returns {{exposureMs: number, hoverMs: number, returnCount: number, repeatedHoverCount: number}}
 */
export function getNormalizationCapsForCandidate(candidate) {
  const platform = resolvePlatformFromSource(candidate.source);
  const layoutType = candidate.layoutType ?? LAYOUT_TYPES.GRID;

  const platformCaps = CONSIDERATION_SCORING_CONFIG.normalizationCapsByPlatform[platform] ??
    CONSIDERATION_SCORING_CONFIG.normalizationCapsByPlatform[PLATFORMS.BILIBILI];
  const layoutCaps = platformCaps?.[layoutType] ??
    platformCaps?.[LAYOUT_TYPES.GRID] ??
    CONSIDERATION_SCORING_CONFIG.normalizationCapsByPlatform[PLATFORMS.BILIBILI][LAYOUT_TYPES.GRID];

  return layoutCaps;
}

/**
 * Provisional P0 Re-encounter parameters. The formula weights are frozen, but
 * the threshold, time windows, and penalty sizes have not been validated and
 * must be calibrated after observing 5-10 people in user tests.
 *
 * noveltyOrDivergence deliberately stays at zero in P0 because the current
 * local keyword signals do not support a reliable, explainable divergence
 * estimate. No Embedding or model fallback is used.
 */
export const REENCOUNTER_SCORING_CONFIG = Object.freeze({
  weights: Object.freeze({
    contextSimilarity: 0.45,
    priorConsideration: 0.25,
    noveltyOrDivergence: 0.15,
    freshness: 0.15
  }),
  threshold: 0.6,
  resultLimits: Object.freeze({
    default: 3,
    min: 1,
    max: 3
  }),
  freshness: Object.freeze({
    horizonMs: 30 * 24 * 60 * 60 * 1_000
  }),
  cooldown: Object.freeze({
    durationMs: 24 * 60 * 60 * 1_000,
    activePenalty: 1
  }),
  repeatedDismissal: Object.freeze({
    penaltyPerDismissal: 0.15,
    maximumPenalty: 0.45
  }),
  noveltyOrDivergence: Object.freeze({
    value: 0,
    mode: "P0_NAMED_ZERO_UNAVAILABLE",
    limitation:
      "No reliable explainable P0 novelty signal is available; no model or Embedding is used."
  }),
  calibration: Object.freeze({
    validated: false,
    status: "UNVALIDATED_PENDING_5_TO_10_PERSON_TEST",
    targetParticipantRange: "5-10"
  })
});
