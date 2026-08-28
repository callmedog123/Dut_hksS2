// @ts-check

import {
  isCandidateTagProfileV1,
  isCandidateV1,
  isContextTagProfileV1,
  isSessionSelectedTagProfileV1,
  isSearchContextV1
} from "../shared/types.js";
import { REENCOUNTER_SCORING_CONFIG } from "./scoringConfig.js";

export const REENCOUNTER_REASON_CODES = Object.freeze({
  CONTEXT_MATCH: "CONTEXT_MATCH",
  // Re-encounter reason DTO v1 has one generic context-match code. Keep that
  // stable while emitting a separate, explicitly labelled tag reason.
  TAG_MATCH: "CONTEXT_MATCH",
  COOLDOWN_PENALTY: "COOLDOWN_PENALTY",
  FRESHNESS: "FRESHNESS",
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
  const candidateTagProfile = entry.candidateTagProfile ?? null;
  if (
    (lastShownAt !== null && !isFiniteNonNegativeNumber(lastShownAt)) ||
    !Number.isInteger(dismissalCount) ||
    dismissalCount < 0 ||
    (candidateTagProfile !== null &&
      (!isCandidateTagProfileV1(candidateTagProfile) ||
        candidateTagProfile.sessionId !==
          entry.missedPath.candidate.sessionId ||
        candidateTagProfile.candidateId !==
          entry.missedPath.candidate.id))
  ) {
    throw new TypeError("Invalid Re-encounter history values.");
  }

  return {
    missedPath: entry.missedPath,
    lastShownAt,
    dismissalCount,
    candidateTagProfile
  };
}

/**
 * Jaccard similarity over already-normalized local tags.
 *
 * @param {readonly string[]} left
 * @param {readonly string[]} right
 */
function calculateTagJaccard(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);
  if (union.size === 0) {
    return 0;
  }
  let intersectionSize = 0;
  for (const tag of leftSet) {
    if (rightSet.has(tag)) {
      intersectionSize += 1;
    }
  }
  return intersectionSize / union.size;
}

/**
 * Scheme A tag relevance. Context tags remain the primary current-intent
 * signal. A non-empty selected profile contributes only one quarter of the
 * tag score; without clicks, the Context profile is used on its own.
 *
 * Missing historical or current Context tag evidence deliberately returns an
 * unavailable result so the caller keeps the legacy keyword/Jaccard path and
 * adds no duplicate keyword bonus.
 *
 * @param {import("../shared/types.js").CandidateTagProfileV1 | null} candidateProfile
 * @param {import("../shared/types.js").ContextTagProfileV1 | null} contextProfile
 * @param {import("../shared/types.js").SessionSelectedTagProfileV1 | null} selectedProfile
 */
export function calculateReencounterTagSimilarity(
  candidateProfile,
  contextProfile,
  selectedProfile = null
) {
  if (
    (candidateProfile !== null &&
      !isCandidateTagProfileV1(candidateProfile)) ||
    (contextProfile !== null && !isContextTagProfileV1(contextProfile)) ||
    (selectedProfile !== null &&
      !isSessionSelectedTagProfileV1(selectedProfile))
  ) {
    throw new TypeError("Expected valid Re-encounter tag profiles.");
  }
  if (
    contextProfile !== null &&
    selectedProfile !== null &&
    contextProfile.sessionId !== selectedProfile.sessionId
  ) {
    throw new TypeError("Current Context and selected tag profiles conflict.");
  }

  if (
    candidateProfile === null ||
    contextProfile === null ||
    candidateProfile.normalizedTags.length === 0 ||
    contextProfile.normalizedTags.length === 0
  ) {
    return {
      available: false,
      similarity: 0,
      contextSimilarity: 0,
      selectedSimilarity: 0,
      usedSelectedProfile: false
    };
  }

  const contextSimilarity = calculateTagJaccard(
    candidateProfile.normalizedTags,
    contextProfile.normalizedTags
  );
  const usedSelectedProfile = Boolean(
    selectedProfile !== null &&
      selectedProfile.selectedCandidateCount > 0 &&
      selectedProfile.tags.length > 0
  );
  const selectedSimilarity = usedSelectedProfile
    ? calculateTagJaccard(
        candidateProfile.normalizedTags,
        selectedProfile.tags.map((entry) => entry.tag)
      )
    : 0;
  const config = REENCOUNTER_SCORING_CONFIG.tagSimilarity;
  const similarity = usedSelectedProfile
    ? contextSimilarity * config.contextProfileWeight +
      selectedSimilarity * config.selectedProfileWeight
    : contextSimilarity;

  return {
    available: true,
    similarity,
    contextSimilarity,
    selectedSimilarity,
    usedSelectedProfile
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
 *   dismissalCount?: number,
 *   candidateTagProfile?: import("../shared/types.js").CandidateTagProfileV1 | null
 * }} entry
 * @param {import("../shared/types.js").SearchContextV1} currentContext
 * @param {{
 *   contextTagProfile?: import("../shared/types.js").ContextTagProfileV1 | null,
 *   sessionSelectedTagProfile?: import("../shared/types.js").SessionSelectedTagProfileV1 | null
 * }} [options]
 */
export function calculateReencounter(entry, currentContext, options = {}) {
  const normalizedEntry = normalizeEntry(entry);
  if (!isSearchContextV1(currentContext) || !isRecord(options)) {
    throw new TypeError("Expected a valid current SearchContextV1.");
  }

  const config = REENCOUNTER_SCORING_CONFIG;
  const now = currentContext.timestamp;
  const contextSimilarity = calculateContextSimilarity(
    normalizedEntry.missedPath.context,
    currentContext
  );
  const priorConsideration = normalizedEntry.missedPath.score;
  const tagMatch = calculateReencounterTagSimilarity(
    normalizedEntry.candidateTagProfile,
    options.contextTagProfile ?? null,
    options.sessionSelectedTagProfile ?? null
  );
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
    tagMatch.similarity * config.weights.tagSimilarity +
    priorConsideration * config.weights.priorConsideration +
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
        label: "搜索词的 Jaccard 相似度为这次情境化重逢提供了依据。",
        contribution:
          contextSimilarity * config.weights.contextSimilarity
      },
      {
        code: REENCOUNTER_REASON_CODES.TAG_MATCH,
        label: tagMatch.available
          ? tagMatch.usedSelectedProfile
            ? "历史候选标签与当前搜索情境标签及本次已选择偏好相似。"
            : "历史候选标签与当前搜索情境标签相似；当前会话没有已选择偏好。"
          : "标签资料不足，已退回现有搜索词/Jaccard 路径，不增加标签分。",
        contribution: tagMatch.similarity * config.weights.tagSimilarity
      },
      {
        code: REENCOUNTER_REASON_CODES.PRIOR_CONSIDERATION,
        label: "此前的考虑程度为这次重逢提供了依据。",
        contribution:
          priorConsideration * config.weights.priorConsideration
      },
      {
        code: REENCOUNTER_REASON_CODES.FRESHNESS,
        label: "该记录仍处于当前的新鲜度时间范围内。",
        contribution: freshness * config.weights.freshness
      },
      {
        code: REENCOUNTER_REASON_CODES.COOLDOWN_PENALTY,
        label: cooldownActive
          ? "该记录仍处于冷却期，因此暂时降低重逢优先级。"
          : "当前没有冷却期惩罚。",
        contribution: -cooldownPenalty
      },
      {
        code: REENCOUNTER_REASON_CODES.REPEATED_DISMISSAL_PENALTY,
        label:
          normalizedEntry.dismissalCount > 0
            ? "此前的“不相关”反馈降低了这次重逢的优先级。"
            : "当前没有重复负反馈惩罚。",
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
 *   dismissalCount?: number,
 *   candidateTagProfile?: import("../shared/types.js").CandidateTagProfileV1 | null
 * }>} entries
 * @param {import("../shared/types.js").SearchContextV1} currentContext
 * @param {{
 *   limit?: number,
 *   contextTagProfile?: import("../shared/types.js").ContextTagProfileV1 | null,
 *   sessionSelectedTagProfile?: import("../shared/types.js").SessionSelectedTagProfileV1 | null
 * }} [options]
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
      const result = calculateReencounter(normalizedEntry, currentContext, {
        contextTagProfile: options.contextTagProfile ?? null,
        sessionSelectedTagProfile:
          options.sessionSelectedTagProfile ?? null
      });
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
