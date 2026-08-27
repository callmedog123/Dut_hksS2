// @ts-check

import { isCandidateSignalsV1 } from "../shared/types.js";
import { CONSIDERATION_SCORING_CONFIG } from "./scoringConfig.js";

export const CONSIDERATION_CLASSIFICATIONS = Object.freeze({
  BELOW_THRESHOLD: "BELOW_THRESHOLD",
  EXCLUDED_CLICKED: "EXCLUDED_CLICKED",
  QUALIFIES: "QUALIFIES"
});

/**
 * @typedef {object} NormalizedConsiderationSignals
 * @property {number} exposure
 * @property {number} hover
 * @property {number} returnView
 * @property {number} repeatedHover
 */

/**
 * @typedef {object} ConsiderationReason
 * @property {"LONG_EXPOSURE" | "LONG_HOVER" | "RETURN_VIEW" | "REPEATED_HOVER" | "NOT_CLICKED"} code
 * @property {string} label
 * @property {number} contribution
 */

/**
 * @typedef {object} ConsiderationResult
 * @property {number} score
 * @property {string} classification
 * @property {ConsiderationReason[]} reasons
 */

function clampUnit(value) {
  return Math.min(1, Math.max(0, value));
}

function normalizeWithCap(value, cap) {
  return clampUnit(value / cap);
}

/**
 * Convert aggregate signals to the four formula inputs. The first hover is
 * not a repeated hover; only later hover entries contribute to that feature.
 *
 * @param {import("../shared/types.js").CandidateSignalsV1} signals
 * @returns {NormalizedConsiderationSignals}
 */
export function normalizeConsiderationSignals(signals) {
  if (!isCandidateSignalsV1(signals)) {
    throw new TypeError("Expected valid CandidateSignalsV1.");
  }

  const caps = CONSIDERATION_SCORING_CONFIG.normalizationCaps;
  return {
    exposure: normalizeWithCap(signals.visibleMs, caps.exposureMs),
    hover: normalizeWithCap(signals.hoverMs, caps.hoverMs),
    returnView: normalizeWithCap(signals.returnCount, caps.returnCount),
    repeatedHover: normalizeWithCap(
      Math.max(0, signals.hoverCount - 1),
      caps.repeatedHoverCount
    )
  };
}

function addReason(reasons, code, label, normalizedValue, weight) {
  if (normalizedValue === 0) {
    return;
  }

  reasons.push({
    code,
    label,
    contribution: normalizedValue * weight
  });
}

/**
 * Apply the frozen P0 consideration formula. This function is deterministic
 * and has no DOM, storage, network, Chrome API, or model dependency.
 *
 * @param {import("../shared/types.js").CandidateSignalsV1} signals
 * @returns {ConsiderationResult}
 */
export function calculateConsideration(signals) {
  const normalized = normalizeConsiderationSignals(signals);

  if (signals.clicked) {
    return {
      score: 0,
      classification: CONSIDERATION_CLASSIFICATIONS.EXCLUDED_CLICKED,
      reasons: []
    };
  }

  const weights = CONSIDERATION_SCORING_CONFIG.weights;
  const reasons = [];
  addReason(
    reasons,
    "LONG_EXPOSURE",
    "较长的累计可见时间表明你曾认真考虑该结果。",
    normalized.exposure,
    weights.exposure
  );
  addReason(
    reasons,
    "LONG_HOVER",
    "较长的累计悬停时间表明你曾认真考虑该结果。",
    normalized.hover,
    weights.hover
  );
  addReason(
    reasons,
    "RETURN_VIEW",
    "再次回看表明你曾认真考虑该结果。",
    normalized.returnView,
    weights.returnView
  );
  addReason(
    reasons,
    "REPEATED_HOVER",
    "多次悬停表明你曾反复考虑该结果。",
    normalized.repeatedHover,
    weights.repeatedHover
  );
  reasons.push({
    code: "NOT_CLICKED",
    label: "你在本次搜索中最终没有选择该结果。",
    contribution: 0
  });

  const score =
    normalized.exposure * weights.exposure +
    normalized.hover * weights.hover +
    normalized.returnView * weights.returnView +
    normalized.repeatedHover * weights.repeatedHover;

  return {
    score,
    classification:
      score >= CONSIDERATION_SCORING_CONFIG.threshold
        ? CONSIDERATION_CLASSIFICATIONS.QUALIFIES
        : CONSIDERATION_CLASSIFICATIONS.BELOW_THRESHOLD,
    reasons
  };
}
