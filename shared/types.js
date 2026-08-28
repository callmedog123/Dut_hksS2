// @ts-check

/** The single version source for messages and Repository envelopes. */
export const SCHEMA_VERSION = 2;

/** The single limit source for tag DTOs and local extraction. */
export const TAG_LIMITS = Object.freeze({
  maxSourceCodePoints: 512,
  maxTagCodePoints: 32,
  maxTags: 12,
  maxNativeTags: 12
});

/** A deliberately small, reviewable stop-word list. */
export const TAG_STOP_WORDS = Object.freeze([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "与",
  "为",
  "从",
  "到",
  "及",
  "和",
  "在",
  "是",
  "的",
  "了",
  "这",
  "那",
  "或"
]);

const TAG_STOP_WORD_SET = new Set(TAG_STOP_WORDS);
const TAG_CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}]+/gu;
const TAG_UNSUPPORTED_CHARACTER_PATTERN = /[^\p{L}\p{N}_\-\s]+/gu;

/**
 * The platform namespace of a supported result page. This value is never
 * persisted; it is derived from the already persisted Candidate `source` by
 * resolvePlatformFromSource() so historical records stay valid unchanged.
 */
export const PLATFORMS = Object.freeze({
  BILIBILI: "BILIBILI",
  ZHIHU: "ZHIHU",
  DOUYIN: "DOUYIN",
  LOCAL_DEMO: "LOCAL_DEMO",
  UNKNOWN: "UNKNOWN"
});

/**
 * The exact, explicit source-to-platform map. Only these literal source values
 * resolve to a known platform; no substring or fuzzy matching is permitted.
 */
export const PLATFORM_SOURCES = Object.freeze({
  "bilibili-search": PLATFORMS.BILIBILI,
  "zhihu-search": PLATFORMS.ZHIHU,
  "douyin-search": PLATFORMS.DOUYIN,
  "local-demo-search": PLATFORMS.LOCAL_DEMO
});

/** The content kinds the three approved platforms may contribute. */
export const CONTENT_TYPES = Object.freeze({
  VIDEO: "VIDEO",
  IMAGE_POST: "IMAGE_POST",
  QUESTION: "QUESTION",
  ANSWER: "ANSWER",
  ARTICLE: "ARTICLE"
});

/** The result-list layouts that later scoring caps may distinguish. */
export const LAYOUT_TYPES = Object.freeze({
  GRID: "GRID",
  TEXT_LIST: "TEXT_LIST",
  VIDEO_FEED: "VIDEO_FEED"
});

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
/** @typedef {typeof PLATFORMS[keyof typeof PLATFORMS]} PlatformV1 */
/** @typedef {typeof CONTENT_TYPES[keyof typeof CONTENT_TYPES]} ContentTypeV1 */
/** @typedef {typeof LAYOUT_TYPES[keyof typeof LAYOUT_TYPES]} LayoutTypeV1 */

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
 * contentType and layoutType are optional only for backward compatibility with
 * v2 records written before the multi-platform contract was frozen. They must
 * appear together or not at all; one without the other is invalid. Every newly
 * produced real-site Candidate is expected to carry both.
 *
 * platform is deliberately absent: it is derived from `source` through
 * resolvePlatformFromSource() so no migration of historical data is required.
 *
 * @typedef {object} CandidateV1
 * @property {string} id
 * @property {string} url
 * @property {string} title
 * @property {string} source
 * @property {number} rank
 * @property {string} sessionId
 * @property {ContentTypeV1} [contentType]
 * @property {LayoutTypeV1} [layoutType]
 */

/**
 * One Candidate's platform-native tags in transit from a Site Adapter to the
 * Background. This is a message-only DTO: nativeTags are persisted through
 * CandidateTagProfileV1, never inside CandidateV1.
 *
 * @typedef {object} CandidateNativeTagsV1
 * @property {string} candidateId
 * @property {readonly string[]} nativeTags
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
 * One aggregated tag of the Candidates a user actually selected in a Session.
 * candidateCount is how many selected Candidates carried the tag, so a tag
 * shared by several selections outranks a tag seen once.
 *
 * @typedef {object} SelectedTagWeightV1
 * @property {string} tag
 * @property {number} candidateCount
 * @property {number} weight
 */

/**
 * The tag profile derived from every clicked Candidate in one Session. With no
 * clicked Candidate this is explicitly empty rather than absent.
 *
 * @typedef {object} SessionSelectedTagProfileV1
 * @property {string} sessionId
 * @property {number} selectedCandidateCount
 * @property {readonly SelectedTagWeightV1[]} tags
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
const CANDIDATE_WITH_CLASSIFICATION_KEYS = Object.freeze([
  ...CANDIDATE_KEYS,
  "contentType",
  "layoutType"
]);
const CANDIDATE_NATIVE_TAGS_KEYS = Object.freeze([
  "candidateId",
  "nativeTags"
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
const SELECTED_TAG_WEIGHT_KEYS = Object.freeze([
  "tag",
  "candidateCount",
  "weight"
]);
const SESSION_SELECTED_TAG_PROFILE_KEYS = Object.freeze([
  "sessionId",
  "selectedCandidateCount",
  "tags"
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

function sliceTagCodePoints(value) {
  return Array.from(value).slice(0, TAG_LIMITS.maxTagCodePoints).join("");
}

function normalizeTagForValidation(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .normalize("NFKC")
    .replace(TAG_CONTROL_OR_FORMAT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/^[#＃]+/u, "")
    .toLocaleLowerCase("und")
    .replace(TAG_UNSUPPORTED_CHARACTER_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const limited = sliceTagCodePoints(normalized).trim();
  return limited && !TAG_STOP_WORD_SET.has(limited) ? limited : null;
}

function normalizeNativeTagForValidation(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value
    .normalize("NFKC")
    .replace(TAG_CONTROL_OR_FORMAT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) {
    return null;
  }

  const limited = sliceTagCodePoints(normalized).trim();
  return normalizeTagForValidation(limited) ? limited : null;
}

function compareTagText(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function isNormalizedTagList(value) {
  return (
    Array.isArray(value) &&
    value.length <= TAG_LIMITS.maxTags &&
    value.every(
      (tag) =>
        typeof tag === "string" && normalizeTagForValidation(tag) === tag
    ) &&
    value.every((tag, index) => index === 0 || value[index - 1] < tag)
  );
}

function isNativeTagList(value) {
  if (
    !Array.isArray(value) ||
    value.length > TAG_LIMITS.maxNativeTags ||
    !value.every(
      (tag) =>
        typeof tag === "string" &&
        normalizeNativeTagForValidation(tag) === tag
    )
  ) {
    return false;
  }

  const normalizedKeys = value.map(normalizeTagForValidation);
  return normalizedKeys.every(
    (tag, index) =>
      tag !== null &&
      (index === 0 ||
        compareTagText(
          normalizedKeys[index - 1],
          tag
        ) < 0)
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
  if (!isRecord(value)) {
    return false;
  }

  const hasContentType = Object.hasOwn(value, "contentType");
  const hasLayoutType = Object.hasOwn(value, "layoutType");
  if (hasContentType !== hasLayoutType) {
    // The multi-platform classification is a pair. One field without the other
    // would let scoring caps read a half-declared Candidate.
    return false;
  }

  return Boolean(
    hasExactKeys(
      value,
      hasContentType ? CANDIDATE_WITH_CLASSIFICATION_KEYS : CANDIDATE_KEYS
    ) &&
      isNonEmptyString(value.id) &&
      isNonEmptyString(value.url) &&
      isNonEmptyString(value.title) &&
      isNonEmptyString(value.source) &&
      Number.isInteger(value.rank) &&
      value.rank > 0 &&
      isNonEmptyString(value.sessionId) &&
      (!hasContentType ||
        (isConstantValue(CONTENT_TYPES, value.contentType) &&
          isConstantValue(LAYOUT_TYPES, value.layoutType)))
  );
}

/**
 * Resolve the platform namespace from an exact Candidate/Context source value.
 * Unknown or non-string sources resolve to the explicit UNKNOWN platform; no
 * substring or fuzzy inference is performed.
 *
 * @param {unknown} source
 * @returns {PlatformV1}
 */
export function resolvePlatformFromSource(source) {
  if (typeof source !== "string" || !Object.hasOwn(PLATFORM_SOURCES, source)) {
    return PLATFORMS.UNKNOWN;
  }
  return PLATFORM_SOURCES[source];
}

/**
 * True when a Candidate carries the frozen multi-platform classification pair.
 * Historical v2 Candidates without it stay valid but report false.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasCandidateClassificationV1(value) {
  return Boolean(
    isCandidateV1(value) && Object.hasOwn(value, "contentType")
  );
}

/**
 * @param {unknown} value
 * @returns {value is CandidateNativeTagsV1}
 */
export function isCandidateNativeTagsV1(value) {
  return Boolean(
    hasExactKeys(value, CANDIDATE_NATIVE_TAGS_KEYS) &&
      isNonEmptyString(value.candidateId) &&
      isNativeTagList(value.nativeTags)
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
    const normalizedTag = normalizeTagForValidation(nativeTag);
    return normalizedTag !== null && normalizedTagSet.has(normalizedTag);
  });
}

/**
 * @param {unknown} value
 * @returns {value is SelectedTagWeightV1}
 */
export function isSelectedTagWeightV1(value) {
  return Boolean(
    hasExactKeys(value, SELECTED_TAG_WEIGHT_KEYS) &&
      typeof value.tag === "string" &&
      normalizeTagForValidation(value.tag) === value.tag &&
      Number.isInteger(value.candidateCount) &&
      value.candidateCount > 0 &&
      isUnitNumber(value.weight) &&
      value.weight > 0
  );
}

/**
 * @param {unknown} value
 * @returns {value is SessionSelectedTagProfileV1}
 */
export function isSessionSelectedTagProfileV1(value) {
  if (
    !hasExactKeys(value, SESSION_SELECTED_TAG_PROFILE_KEYS) ||
    !isNonEmptyString(value.sessionId) ||
    !isNonNegativeInteger(value.selectedCandidateCount) ||
    !Array.isArray(value.tags) ||
    value.tags.length > TAG_LIMITS.maxTags ||
    !value.tags.every(isSelectedTagWeightV1)
  ) {
    return false;
  }

  if (value.selectedCandidateCount === 0) {
    return value.tags.length === 0;
  }

  return value.tags.every((entry, index) => {
    if (entry.candidateCount > value.selectedCandidateCount) {
      return false;
    }
    if (index === 0) {
      return true;
    }
    const previous = value.tags[index - 1];
    return (
      previous.candidateCount > entry.candidateCount ||
      (previous.candidateCount === entry.candidateCount &&
        compareTagText(previous.tag, entry.tag) < 0)
    );
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
