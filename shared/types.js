// @ts-check

import {
  TAG_LIMITS,
  isCanonicalNativeTag,
  isNormalizedTag,
  normalizeNativeTags,
  normalizeTag
} from "./tags.js";

/** The single version source for messages and Repository envelopes. */
export const SCHEMA_VERSION = 2;

export const CONSIDERATION_REASON_CODES = Object.freeze({
  LONG_EXPOSURE: "LONG_EXPOSURE",
  LONG_HOVER: "LONG_HOVER",
  NOT_CLICKED: "NOT_CLICKED",
  REPEATED_HOVER: "REPEATED_HOVER",
  RETURN_VIEW: "RETURN_VIEW"
});

export const MISSED_PATH_STATUSES = Object.freeze({
  ARCHIVED: "ARCHIVED",
  ELIGIBLE: "ELIGIBLE",
  MISSED: "MISSED",
  REENCOUNTERED: "REENCOUNTERED"
});

export const REENCOUNTER_REASON_CODES = Object.freeze({
  CONTEXT_MATCH: "CONTEXT_MATCH",
  COOLDOWN_PENALTY: "COOLDOWN_PENALTY",
  FRESHNESS: "FRESHNESS",
  NOVELTY_OR_DIVERGENCE_P0_ZERO: "NOVELTY_OR_DIVERGENCE_P0_ZERO",
  PRIOR_CONSIDERATION: "PRIOR_CONSIDERATION",
  REPEATED_DISMISSAL_PENALTY: "REPEATED_DISMISSAL_PENALTY"
});

export const REENCOUNTER_OUTCOMES = Object.freeze({
  DELETED: "DELETED",
  DISMISSED: "DISMISSED",
  LATER: "LATER",
  NOT_RELEVANT: "NOT_RELEVANT",
  OPENED: "OPENED"
});

export const REENCOUNTER_FEEDBACK_OUTCOMES = Object.freeze({
  LATER: REENCOUNTER_OUTCOMES.LATER,
  NOT_RELEVANT: REENCOUNTER_OUTCOMES.NOT_RELEVANT,
  OPENED: REENCOUNTER_OUTCOMES.OPENED
});

export const SESSION_LIFECYCLE_STATUSES = Object.freeze({
  OPEN: "OPEN",
  FINALIZING: "FINALIZING",
  FINALIZED: "FINALIZED",
  ABANDONED: "ABANDONED"
});

export const DEFAULT_SETTINGS_V1 = Object.freeze({
  enabled: true,
  allowlist: Object.freeze([]),
  blocklist: Object.freeze([]),
  thresholds: Object.freeze({ consideration: 0.55, reencounter: 0.6 }),
  demoMode: false
});

/** @typedef {typeof CONSIDERATION_REASON_CODES[keyof typeof CONSIDERATION_REASON_CODES]} ConsiderationReasonCodeV1 */
/** @typedef {typeof MISSED_PATH_STATUSES[keyof typeof MISSED_PATH_STATUSES]} MissedPathStatusV1 */
/** @typedef {typeof REENCOUNTER_REASON_CODES[keyof typeof REENCOUNTER_REASON_CODES]} ReencounterReasonCodeV1 */
/** @typedef {typeof REENCOUNTER_OUTCOMES[keyof typeof REENCOUNTER_OUTCOMES]} ReencounterOutcomeV1 */
/** @typedef {typeof REENCOUNTER_FEEDBACK_OUTCOMES[keyof typeof REENCOUNTER_FEEDBACK_OUTCOMES]} ReencounterFeedbackOutcomeV1 */
/** @typedef {typeof SESSION_LIFECYCLE_STATUSES[keyof typeof SESSION_LIFECYCLE_STATUSES]} SessionLifecycleStatusV2 */

/**
 * Background-authoritative identity for one content-document Session.
 * Content scripts never place this object in a message payload.
 *
 * @typedef {object} SessionOwnerV1
 * @property {number} tabId
 * @property {string} documentId
 * @property {number} frameId
 * @property {string} sessionId
 */

/**
 * @typedef {object} SettingsV1
 * @property {boolean} enabled
 * @property {readonly string[]} allowlist
 * @property {readonly string[]} blocklist
 * @property {{consideration: number, reencounter: number}} thresholds
 * @property {boolean} demoMode
 */

/**
 * A normalized result candidate emitted by a Site Adapter.
 *
 * @typedef {object} CandidateV1
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} source
 * @property {number} rank
 * @property {string} sessionId
 */

/**
 * Minimal context for the search session that produced candidates.
 *
 * @typedef {object} SearchContextV1
 * @property {string} query
 * @property {string} source
 * @property {number} timestamp
 * @property {string[]} [keywords]
 */

/**
 * Local, site-independent tags extracted from one search Context.
 *
 * @typedef {object} ContextTagProfileV1
 * @property {string} sessionId
 * @property {readonly string[]} normalizedTags
 */

/**
 * Candidate tags with platform labels kept separate from normalized tags.
 *
 * @typedef {object} CandidateTagProfileV1
 * @property {string} candidateId
 * @property {string} sessionId
 * @property {readonly string[]} nativeTags
 * @property {readonly string[]} normalizedTags
 */

/**
 * Minimal aggregate signals retained for one Candidate.
 *
 * @typedef {object} CandidateSignalsV1
 * @property {string} candidateId
 * @property {string} sessionId
 * @property {number} visibleMs
 * @property {number} hoverMs
 * @property {number} hoverCount
 * @property {number} returnCount
 * @property {boolean} clicked
 */

/**
 * One explainable contribution to a persisted Consideration Score.
 *
 * @typedef {object} ConsiderationReasonV1
 * @property {ConsiderationReasonCodeV1} code
 * @property {string} label
 * @property {number} [contribution]
 */

/**
 * A locally persisted Candidate that qualified as a Missed Path.
 *
 * @typedef {object} MissedPathV1
 * @property {string} id
 * @property {CandidateV1} candidate
 * @property {SearchContextV1} context
 * @property {number} score
 * @property {ConsiderationReasonV1[]} reasons
 * @property {MissedPathStatusV1} status
 * @property {number} createdAt
 */

/**
 * One explainable contribution or penalty in a Re-encounter score.
 *
 * @typedef {object} ReencounterReasonV1
 * @property {ReencounterReasonCodeV1} code
 * @property {string} label
 * @property {number} [contribution]
 */

/**
 * A query-only ranked result. This is intentionally not the persisted
 * Reencounter record shape used by the Repository.
 *
 * @typedef {object} RankedReencounterV1
 * @property {MissedPathV1} missedPath
 * @property {number} score
 * @property {ReencounterReasonV1[]} reasons
 */

/**
 * The durable Re-encounter record. A record written when a card is shown has
 * no outcome; a later feedback operation may add the optional outcome.
 *
 * @typedef {object} ReencounterRecordV1
 * @property {string} id
 * @property {string} missedPathId
 * @property {SearchContextV1} triggerContext
 * @property {number} score
 * @property {ReencounterReasonV1[]} reasons
 * @property {number} shownAt
 * @property {ReencounterOutcomeV1} [outcome]
 * @property {number} [feedbackAt]
 */

/**
 * @typedef {object} ReencounterFeedbackV1
 * @property {string} reencounterId
 * @property {ReencounterFeedbackOutcomeV1} outcome
 * @property {number} feedbackAt
 */

const CANDIDATE_KEYS = Object.freeze([
  "id",
  "url",
  "title",
  "source",
  "rank",
  "sessionId"
]);
const SEARCH_CONTEXT_KEYS = Object.freeze([
  "query",
  "source",
  "timestamp"
]);
const SEARCH_CONTEXT_WITH_KEYWORDS_KEYS = Object.freeze([
  ...SEARCH_CONTEXT_KEYS,
  "keywords"
]);
const CANDIDATE_SIGNALS_KEYS = Object.freeze([
  "candidateId",
  "sessionId",
  "visibleMs",
  "hoverMs",
  "hoverCount",
  "returnCount",
  "clicked"
]);
const CONSIDERATION_REASON_KEYS = Object.freeze(["code", "label"]);
const CONSIDERATION_REASON_WITH_CONTRIBUTION_KEYS = Object.freeze([
  ...CONSIDERATION_REASON_KEYS,
  "contribution"
]);
const MISSED_PATH_KEYS = Object.freeze([
  "id",
  "candidate",
  "context",
  "score",
  "reasons",
  "status",
  "createdAt"
]);
const REENCOUNTER_REASON_KEYS = Object.freeze(["code", "label"]);
const REENCOUNTER_REASON_WITH_CONTRIBUTION_KEYS = Object.freeze([
  ...REENCOUNTER_REASON_KEYS,
  "contribution"
]);
const RANKED_REENCOUNTER_KEYS = Object.freeze([
  "missedPath",
  "score",
  "reasons"
]);
const REENCOUNTER_RECORD_KEYS = Object.freeze([
  "id",
  "missedPathId",
  "triggerContext",
  "score",
  "reasons",
  "shownAt"
]);
const REENCOUNTER_RECORD_WITH_OUTCOME_KEYS = Object.freeze([
  ...REENCOUNTER_RECORD_KEYS,
  "outcome"
]);
const REENCOUNTER_RECORD_WITH_FEEDBACK_KEYS = Object.freeze([
  ...REENCOUNTER_RECORD_WITH_OUTCOME_KEYS,
  "feedbackAt"
]);
const REENCOUNTER_FEEDBACK_KEYS = Object.freeze([
  "reencounterId",
  "outcome",
  "feedbackAt"
]);
const SETTINGS_KEYS = Object.freeze([
  "enabled",
  "allowlist",
  "blocklist",
  "thresholds",
  "demoMode"
]);
const SESSION_OWNER_KEYS = Object.freeze([
  "tabId",
  "documentId",
  "frameId",
  "sessionId"
]);
const CONTEXT_TAG_PROFILE_KEYS = Object.freeze([
  "sessionId",
  "normalizedTags"
]);
const CANDIDATE_TAG_PROFILE_KEYS = Object.freeze([
  "candidateId",
  "sessionId",
  "nativeTags",
  "normalizedTags"
]);

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expectedKeys) {
  if (!isRecord(value)) {
    return false;
  }

  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isFiniteNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function isUnitNumber(value) {
  return isFiniteNonNegativeNumber(value) && value <= 1;
}

function isStringList(value) {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function isConstantValue(constants, value) {
  return Object.values(constants).includes(value);
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function isNormalizedTagList(value) {
  return (
    Array.isArray(value) &&
    value.length <= TAG_LIMITS.maxTags &&
    value.every(isNormalizedTag) &&
    value.every((tag, index) => index === 0 || value[index - 1] < tag)
  );
}

function isNativeTagList(value) {
  if (
    !Array.isArray(value) ||
    value.length > TAG_LIMITS.maxNativeTags ||
    !value.every(isCanonicalNativeTag)
  ) {
    return false;
  }

  const canonical = normalizeNativeTags(value);
  return (
    canonical.length === value.length &&
    canonical.every((tag, index) => tag === value[index])
  );
}

/**
 * @param {unknown} value
 * @returns {value is SessionOwnerV1}
 */
export function isSessionOwnerV1(value) {
  return Boolean(
    hasExactKeys(value, SESSION_OWNER_KEYS) &&
      isNonNegativeInteger(value.tabId) &&
      isNonEmptyString(value.documentId) &&
      isNonNegativeInteger(value.frameId) &&
      isNonEmptyString(value.sessionId)
  );
}

/**
 * @param {unknown} value
 * @returns {value is SessionLifecycleStatusV2}
 */
export function isSessionLifecycleStatusV2(value) {
  return isConstantValue(SESSION_LIFECYCLE_STATUSES, value);
}

/**
 * @param {unknown} value
 * @returns {value is CandidateV1}
 */
export function isCandidateV1(value) {
  return Boolean(
    hasExactKeys(value, CANDIDATE_KEYS) &&
      isNonEmptyString(value.id) &&
      isNonEmptyString(value.url) &&
      isNonEmptyString(value.title) &&
      isNonEmptyString(value.source) &&
      Number.isInteger(value.rank) &&
      value.rank > 0 &&
      isNonEmptyString(value.sessionId)
  );
}

/**
 * @param {unknown} value
 * @returns {value is SearchContextV1}
 */
export function isSearchContextV1(value) {
  if (!isRecord(value)) {
    return false;
  }

  const hasKeywords = Object.hasOwn(value, "keywords");
  const expectedKeys = hasKeywords
    ? SEARCH_CONTEXT_WITH_KEYWORDS_KEYS
    : SEARCH_CONTEXT_KEYS;
  return Boolean(
    hasExactKeys(value, expectedKeys) &&
      typeof value.query === "string" &&
      isNonEmptyString(value.source) &&
      typeof value.timestamp === "number" &&
      Number.isFinite(value.timestamp) &&
      (!hasKeywords ||
        (Array.isArray(value.keywords) &&
          value.keywords.every(isNonEmptyString)))
  );
}

/**
 * @param {unknown} value
 * @returns {value is ContextTagProfileV1}
 */
export function isContextTagProfileV1(value) {
  return Boolean(
    hasExactKeys(value, CONTEXT_TAG_PROFILE_KEYS) &&
      isNonEmptyString(value.sessionId) &&
      isNormalizedTagList(value.normalizedTags)
  );
}

/**
 * @param {unknown} value
 * @returns {value is CandidateTagProfileV1}
 */
export function isCandidateTagProfileV1(value) {
  if (
    !hasExactKeys(value, CANDIDATE_TAG_PROFILE_KEYS) ||
    !isNonEmptyString(value.candidateId) ||
    !isNonEmptyString(value.sessionId) ||
    !isNativeTagList(value.nativeTags) ||
    !isNormalizedTagList(value.normalizedTags)
  ) {
    return false;
  }

  const normalizedTagSet = new Set(value.normalizedTags);
  return value.nativeTags.every((nativeTag) => {
    const normalizedTag = normalizeTag(nativeTag);
    return normalizedTag !== null && normalizedTagSet.has(normalizedTag);
  });
}

/**
 * @param {unknown} value
 * @returns {value is CandidateSignalsV1}
 */
export function isCandidateSignalsV1(value) {
  return Boolean(
    hasExactKeys(value, CANDIDATE_SIGNALS_KEYS) &&
      isNonEmptyString(value.candidateId) &&
      isNonEmptyString(value.sessionId) &&
      isFiniteNonNegativeNumber(value.visibleMs) &&
      isFiniteNonNegativeNumber(value.hoverMs) &&
      isNonNegativeInteger(value.hoverCount) &&
      isNonNegativeInteger(value.returnCount) &&
      typeof value.clicked === "boolean"
  );
}

/**
 * @param {unknown} value
 * @returns {value is ConsiderationReasonV1}
 */
export function isConsiderationReasonV1(value) {
  if (!isRecord(value)) {
    return false;
  }

  const hasContribution = Object.hasOwn(value, "contribution");
  return Boolean(
    hasExactKeys(
      value,
      hasContribution
        ? CONSIDERATION_REASON_WITH_CONTRIBUTION_KEYS
        : CONSIDERATION_REASON_KEYS
    ) &&
      isConstantValue(CONSIDERATION_REASON_CODES, value.code) &&
      isNonEmptyString(value.label) &&
      (!hasContribution || isFiniteNonNegativeNumber(value.contribution))
  );
}

/**
 * @param {unknown} value
 * @returns {value is MissedPathV1}
 */
export function isMissedPathV1(value) {
  return Boolean(
    hasExactKeys(value, MISSED_PATH_KEYS) &&
      isNonEmptyString(value.id) &&
      isCandidateV1(value.candidate) &&
      isSearchContextV1(value.context) &&
      isUnitNumber(value.score) &&
      Array.isArray(value.reasons) &&
      value.reasons.every(isConsiderationReasonV1) &&
      isConstantValue(MISSED_PATH_STATUSES, value.status) &&
      isFiniteNonNegativeNumber(value.createdAt)
  );
}

/**
 * Re-encounter reasons allow finite positive contributions, neutral zero, and
 * finite negative penalty contributions.
 *
 * @param {unknown} value
 * @returns {value is ReencounterReasonV1}
 */
export function isReencounterReasonV1(value) {
  if (!isRecord(value)) {
    return false;
  }

  const hasContribution = Object.hasOwn(value, "contribution");
  return Boolean(
    hasExactKeys(
      value,
      hasContribution
        ? REENCOUNTER_REASON_WITH_CONTRIBUTION_KEYS
        : REENCOUNTER_REASON_KEYS
    ) &&
      isConstantValue(REENCOUNTER_REASON_CODES, value.code) &&
      isNonEmptyString(value.label) &&
      (!hasContribution || isFiniteNumber(value.contribution))
  );
}

/**
 * @param {unknown} value
 * @returns {value is RankedReencounterV1}
 */
export function isRankedReencounterV1(value) {
  return Boolean(
    hasExactKeys(value, RANKED_REENCOUNTER_KEYS) &&
      isMissedPathV1(value.missedPath) &&
      isUnitNumber(value.score) &&
      Array.isArray(value.reasons) &&
      value.reasons.every(isReencounterReasonV1)
  );
}

/**
 * @param {unknown} value
 * @returns {value is ReencounterRecordV1}
 */
export function isReencounterRecordV1(value) {
  if (!isRecord(value)) {
    return false;
  }

  const hasOutcome = Object.hasOwn(value, "outcome");
  const hasFeedbackAt = Object.hasOwn(value, "feedbackAt");
  return Boolean(
    hasExactKeys(
      value,
      hasFeedbackAt
        ? REENCOUNTER_RECORD_WITH_FEEDBACK_KEYS
        : hasOutcome
        ? REENCOUNTER_RECORD_WITH_OUTCOME_KEYS
        : REENCOUNTER_RECORD_KEYS
    ) &&
      isNonEmptyString(value.id) &&
      isNonEmptyString(value.missedPathId) &&
      isSearchContextV1(value.triggerContext) &&
      isUnitNumber(value.score) &&
      Array.isArray(value.reasons) &&
      value.reasons.every(isReencounterReasonV1) &&
      isFiniteNonNegativeNumber(value.shownAt) &&
      (!hasOutcome || isConstantValue(REENCOUNTER_OUTCOMES, value.outcome)) &&
      (!hasFeedbackAt ||
        (hasOutcome && isFiniteNonNegativeNumber(value.feedbackAt)))
  );
}

/**
 * @param {unknown} value
 * @returns {value is ReencounterFeedbackV1}
 */
export function isReencounterFeedbackV1(value) {
  return Boolean(
    hasExactKeys(value, REENCOUNTER_FEEDBACK_KEYS) &&
      isNonEmptyString(value.reencounterId) &&
      isConstantValue(REENCOUNTER_FEEDBACK_OUTCOMES, value.outcome) &&
      isFiniteNonNegativeNumber(value.feedbackAt)
  );
}

/**
 * @param {unknown} value
 * @returns {value is SettingsV1}
 */
export function isSettingsV1(value) {
  return Boolean(
    hasExactKeys(value, SETTINGS_KEYS) &&
      typeof value.enabled === "boolean" &&
      isStringList(value.allowlist) &&
      isStringList(value.blocklist) &&
      hasExactKeys(value.thresholds, ["consideration", "reencounter"]) &&
      isUnitNumber(value.thresholds.consideration) &&
      isUnitNumber(value.thresholds.reencounter) &&
      typeof value.demoMode === "boolean"
  );
}
