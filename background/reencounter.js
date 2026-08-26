// @ts-check

import {
  isCandidateV1,
  isSearchContextV1
} from "../shared/types.js";
import { REENCOUNTER_SCORING_CONFIG } from "./scoringConfig.js";

export const REENCOUNTER_REASON_CODES = Object.freeze({
  CONTEXT_MATCH: "CONTEXT_MATCH",
  COOLDOWN_PENALTY: "COOLDOWN_PENALTY",
  FRESHNESS: "FRESHNESS",
  NOVELTY_OR_DIVERGENCE_P0_ZERO: "NOVELTY_OR_DIVERGENCE_P0_ZERO",
  PRIOR_CONSIDERATION: "PRIOR_CONSIDERATION",
  REPEATED_DISMISSAL_PENALTY: "REPEATED_DISMISSAL_PENALTY"
});

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isUnitNumber(value) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function clampUnit(value) {
  return Math.min(1, Math.max(0, value));
}

function tokenize(value) {
  return (
    value
      .normalize("NFKC")
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

function contextKeywordSet(context) {
  if (!isSearchContextV1(context)) {
    throw new TypeError("Expected a valid SearchContextV1.");
  }

  const values = [context.query, ...(context.keywords ?? [])];
  return new Set(values.flatMap(tokenize));
}

function isMissedPathForScoring(value) {
  return Boolean(
    isRecord(value) &&
      isNonEmptyString(value.id) &&
      isCandidateV1(value.candidate) &&
      isSearchContextV1(value.context) &&
      isUnitNumber(value.score) &&
      isFiniteNonNegativeNumber(value.createdAt)
  );
}

function normalizeEntry(entry) {
  if (!isRecord(entry) || !isMissedPathForScoring(entry.missedPath)) {
    throw new TypeError("Expected a valid MissedPath scoring entry.");
  }

  const lastShownAt = entry.lastShownAt ?? null;
  const dismissalCount = entry.dismissalCount ?? 0;
  if (
    (lastShownAt !== null && !isFiniteNonNegativeNumber(lastShownAt)) ||
    !Number.isInteger(dismissalCount) ||
    dismissalCount < 0
  ) {
    throw new TypeError("Invalid Re-encounter history values.");
  }

  return {
    missedPath: entry.missedPath,
    lastShownAt,
    dismissalCount
  };
}

/**
 * Keyword Jaccard similarity for two minimal search contexts. Empty keyword
 * evidence produces zero similarity rather than treating two empty sets as a
 * match.
 *
 * @param {import("../shared/types.js").SearchContextV1} previousContext
 * @param {import("../shared/types.js").SearchContextV1} currentContext
 */
export function calculateContextSimilarity(previousContext, currentContext) {
  const previousKeywords = contextKeywordSet(previousContext);
  const currentKeywords = contextKeywordSet(currentContext);
  const union = new Set([...previousKeywords, ...currentKeywords]);
  if (union.size === 0) {
    return 0;
  }

  let intersectionSize = 0;
  for (const keyword of previousKeywords) {
    if (currentKeywords.has(keyword)) {
      intersectionSize += 1;
    }
  }
  return intersectionSize / union.size;
}

/**
 * Score one MissedPath against the current context without accessing time,
 * storage, DOM, network, Chrome APIs, Embeddings, or models.
 *
 * @param {{
 *   missedPath: object,
 *   lastShownAt?: number | null,
 *   dismissalCount?: number
 * }} entry
 * @param {import("../shared/types.js").SearchContextV1} currentContext
 */
export function calculateReencounter(entry, currentContext) {
  const normalizedEntry = normalizeEntry(entry);
  if (!isSearchContextV1(currentContext)) {
    throw new TypeError("Expected a valid current SearchContextV1.");
  }

  const config = REENCOUNTER_SCORING_CONFIG;
  const now = currentContext.timestamp;
  const contextSimilarity = calculateContextSimilarity(
    normalizedEntry.missedPath.context,
    currentContext
  );
  const priorConsideration = normalizedEntry.missedPath.score;
  const noveltyOrDivergence = config.noveltyOrDivergence.value;
  const ageMs = Math.max(0, now - normalizedEntry.missedPath.createdAt);
  const freshness = clampUnit(1 - ageMs / config.freshness.horizonMs);
  const cooldownActive =
    normalizedEntry.lastShownAt !== null &&
    now - normalizedEntry.lastShownAt < config.cooldown.durationMs;
  const cooldownPenalty = cooldownActive
    ? config.cooldown.activePenalty
    : 0;
  const repeatedDismissalPenalty = Math.min(
    config.repeatedDismissal.maximumPenalty,
    normalizedEntry.dismissalCount *
      config.repeatedDismissal.penaltyPerDismissal
  );

  const positiveScore =
    contextSimilarity * config.weights.contextSimilarity +
    priorConsideration * config.weights.priorConsideration +
    noveltyOrDivergence * config.weights.noveltyOrDivergence +
    freshness * config.weights.freshness;
  const score = clampUnit(
    positiveScore - cooldownPenalty - repeatedDismissalPenalty
  );

  return {
    score,
    eligible: score >= config.threshold,
    reasons: [
      {
        code: REENCOUNTER_REASON_CODES.CONTEXT_MATCH,
        label: "Keyword Jaccard similarity contributed to Re-encounter relevance.",
        contribution:
          contextSimilarity * config.weights.contextSimilarity
      },
      {
        code: REENCOUNTER_REASON_CODES.PRIOR_CONSIDERATION,
        label: "The prior Consideration Score contributed to Re-encounter relevance.",
        contribution:
          priorConsideration * config.weights.priorConsideration
      },
      {
        code:
          REENCOUNTER_REASON_CODES.NOVELTY_OR_DIVERGENCE_P0_ZERO,
        label: config.noveltyOrDivergence.limitation,
        contribution: 0
      },
      {
        code: REENCOUNTER_REASON_CODES.FRESHNESS,
        label: "Recency within the provisional freshness horizon contributed to relevance.",
        contribution: freshness * config.weights.freshness
      },
      {
        code: REENCOUNTER_REASON_CODES.COOLDOWN_PENALTY,
        label: cooldownActive
          ? "The Candidate is still inside the provisional cooldown window."
          : "No cooldown penalty applies.",
        contribution: -cooldownPenalty
      },
      {
        code: REENCOUNTER_REASON_CODES.REPEATED_DISMISSAL_PENALTY,
        label:
          normalizedEntry.dismissalCount > 0
            ? "Prior dismissals reduced Re-encounter relevance."
            : "No repeated dismissal penalty applies.",
        contribution: -repeatedDismissalPenalty
      }
    ]
  };
}

function compareRanked(left, right) {
  if (left.score !== right.score) {
    return right.score - left.score;
  }
  if (left.missedPath.id === right.missedPath.id) {
    return 0;
  }
  return left.missedPath.id < right.missedPath.id ? -1 : 1;
}

/**
 * Return at most the requested 1-3 eligible results in deterministic order.
 *
 * @param {Array<{
 *   missedPath: object,
 *   lastShownAt?: number | null,
 *   dismissalCount?: number
 * }>} entries
 * @param {import("../shared/types.js").SearchContextV1} currentContext
 * @param {{limit?: number}} [options]
 */
export function rankReencounters(entries, currentContext, options = {}) {
  if (!Array.isArray(entries)) {
    throw new TypeError("Re-encounter entries must be an array.");
  }
  if (!isRecord(options)) {
    throw new TypeError("Re-encounter options must be an object.");
  }
  const limit = options.limit ?? REENCOUNTER_SCORING_CONFIG.resultLimits.default;
  if (
    !Number.isInteger(limit) ||
    limit < REENCOUNTER_SCORING_CONFIG.resultLimits.min ||
    limit > REENCOUNTER_SCORING_CONFIG.resultLimits.max
  ) {
    throw new RangeError("Re-encounter limit must be an integer from 1 to 3.");
  }

  return entries
    .map((entry) => {
      const normalizedEntry = normalizeEntry(entry);
      const result = calculateReencounter(normalizedEntry, currentContext);
      return {
        missedPath: normalizedEntry.missedPath,
        score: result.score,
        reasons: result.reasons,
        eligible: result.eligible
      };
    })
    .filter((result) => result.eligible)
    .sort(compareRanked)
    .slice(0, limit)
    .map(({ eligible: _eligible, ...result }) => result);
}
