// @ts-check

import { isCandidateSignalsV1, PLATFORMS, LAYOUT_TYPES } from "../shared/types.js";
import { CONSIDERATION_SCORING_CONFIG, getNormalizationCapsForCandidate } from "./scoringConfig.js";

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
 * @property {"LONG_EXPOSURE" | "LONG_HOVER" | "RETURN_VIEW" | "REPEATED_HOVER" | "SELECTED_TAG_SIMILARITY" | "NOT_CLICKED"} code
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
 * For v2, caps are platform- and layout-specific. When candidate is absent
 * (legacy calls), fall back to the BILIBILI/GRID default.
 *
 * @param {import("../shared/types.js").CandidateSignalsV1} signals
 * @param {import("../shared/types.js").CandidateV1} [candidate]
 * @returns {NormalizedConsiderationSignals}
 */
export function normalizeConsiderationSignals(signals, candidate) {
  if (!isCandidateSignalsV1(signals)) {
    throw new TypeError("Expected valid CandidateSignalsV1.");
  }

  const caps = candidate !== undefined && candidate !== null
    ? getNormalizationCapsForCandidate(candidate)
    : CONSIDERATION_SCORING_CONFIG.normalizationCapsByPlatform[PLATFORMS.BILIBILI][LAYOUT_TYPES.GRID];
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
 * Compute Jaccard similarity between two sets of normalized tags.
 *
 * @param {readonly string[]} tagsA
 * @param {readonly string[]} tagsB
 * @returns {number}
 */
function jaccardSimilarity(tagsA, tagsB) {
  const setA = new Set(tagsA);
  const setB = new Set(tagsB);
  const intersection = [...setA].filter((tag) => setB.has(tag)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Apply the frozen Consideration Score v2 formula (approved 2026-08-29).
 * This function is deterministic and has no DOM, storage, network, Chrome API,
 * or model dependency.
 *
 * @param {import("../shared/types.js").CandidateSignalsV1} signals
 * @param {{candidate?: import("../shared/types.js").CandidateV1, candidateTagProfile?: import("../shared/types.js").CandidateTagProfileV1, sessionSelectedTagProfile?: import("../shared/types.js").SessionSelectedTagProfileV1}} [context]
 * @returns {ConsiderationResult}
 */
export function calculateConsideration(signals, context) {
  const candidate = context?.candidate ?? null;
  const candidateTagProfile = context?.candidateTagProfile ?? null;
  const sessionSelectedTagProfile = context?.sessionSelectedTagProfile ?? null;

  const normalized = normalizeConsiderationSignals(signals, candidate);

  if (signals.clicked) {
    return {
      score: 0,
      classification: CONSIDERATION_CLASSIFICATIONS.EXCLUDED_CLICKED,
      reasons: []
    };
  }

  const weights = CONSIDERATION_SCORING_CONFIG.weights;
  const reasons = [];

  // Behavior reasons
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

  // Behavior score
  const behaviorScore =
    normalized.exposure * weights.exposure +
    normalized.hover * weights.hover +
    normalized.returnView * weights.returnView +
    normalized.repeatedHover * weights.repeatedHover;

  // Tag similarity (v2 addition)
  let selectedTagSimilarity = 0;
  if (
    sessionSelectedTagProfile !== null &&
    sessionSelectedTagProfile.selectedCandidateCount > 0 &&
    Array.isArray(sessionSelectedTagProfile.tags) &&
    sessionSelectedTagProfile.tags.length > 0
  ) {
    const candidateTags = candidateTagProfile?.normalizedTags ?? [];
    const selectedTags = sessionSelectedTagProfile.tags.map((entry) => entry.tag);
    selectedTagSimilarity = jaccardSimilarity(candidateTags, selectedTags);
  }

  const tagBonus = selectedTagSimilarity * weights.selectedTagSimilarity;

  if (selectedTagSimilarity > 0) {
    addReason(
      reasons,
      "SELECTED_TAG_SIMILARITY",
      "与你已选择结果共享的标签表明你可能对该结果感兴趣。",
      selectedTagSimilarity,
      weights.selectedTagSimilarity
    );
  }

  reasons.push({
    code: "NOT_CLICKED",
    label: "你在本次搜索中最终没有选择该结果。",
    contribution: 0
  });

  // Minimum behavior threshold (tags cannot bypass this)
  if (behaviorScore < CONSIDERATION_SCORING_CONFIG.minimumBehaviorThreshold) {
    return {
      score: behaviorScore + tagBonus,
      classification: CONSIDERATION_CLASSIFICATIONS.BELOW_THRESHOLD,
      reasons
    };
  }

  const totalScore = behaviorScore + tagBonus;

  return {
    score: totalScore,
    classification:
      totalScore >= CONSIDERATION_SCORING_CONFIG.threshold
        ? CONSIDERATION_CLASSIFICATIONS.QUALIFIES
        : CONSIDERATION_CLASSIFICATIONS.BELOW_THRESHOLD,
    reasons
  };
}
