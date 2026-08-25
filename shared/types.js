// @ts-check

/** The single version source for all shared v1 contracts. */
export const SCHEMA_VERSION = 1;

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

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
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
