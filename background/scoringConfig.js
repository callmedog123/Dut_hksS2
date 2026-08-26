// @ts-check

/**
 * Provisional P0 normalization caps. These values have not been validated and
 * must be calibrated after observing 5-10 people in user tests.
 */
export const CONSIDERATION_SCORING_CONFIG = Object.freeze({
  weights: Object.freeze({
    exposure: 0.3,
    hover: 0.3,
    returnView: 0.25,
    repeatedHover: 0.15
  }),
  normalizationCaps: Object.freeze({
    exposureMs: 10_000,
    hoverMs: 3_000,
    returnCount: 2,
    repeatedHoverCount: 3
  }),
  threshold: 0.55,
  calibration: Object.freeze({
    validated: false,
    status: "UNVALIDATED_PENDING_5_TO_10_PERSON_TEST",
    targetParticipantRange: "5-10"
  })
});

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
