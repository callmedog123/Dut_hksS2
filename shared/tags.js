// @ts-check

import { TAG_LIMITS, TAG_STOP_WORDS } from "./types.js";

export { TAG_LIMITS, TAG_STOP_WORDS };

const STOP_WORD_SET = new Set(TAG_STOP_WORDS);
const CONTROL_OR_FORMAT_PATTERN = /[\p{Cc}\p{Cf}]+/gu;
const HASHTAG_PATTERN = /[#＃]([\p{L}\p{N}_-]+)/gu;
const LOCAL_TOKEN_PATTERN = /\p{Script=Han}+|[\p{Script=Latin}\p{N}]+/gu;
const UNSUPPORTED_NORMALIZED_CHARACTER_PATTERN =
  /[^\p{L}\p{N}_\-\s]+/gu;

function compareText(left, right) {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function sliceCodePoints(value, maximum) {
  return Array.from(value).slice(0, maximum).join("");
}

function normalizeUnicodeText(value) {
  return value
    .normalize("NFKC")
    .replace(CONTROL_OR_FORMAT_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Convert one tag to its site-independent comparison/storage representation.
 * Invalid, empty, punctuation-only and stop-word values yield null.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeTag(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeUnicodeText(value)
    .replace(/^[#＃]+/u, "")
    .toLocaleLowerCase("und")
    .replace(UNSUPPORTED_NORMALIZED_CHARACTER_PATTERN, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const limited = sliceCodePoints(normalized, TAG_LIMITS.maxTagCodePoints).trim();

  if (!limited || STOP_WORD_SET.has(limited)) {
    return null;
  }
  return limited;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isNormalizedTag(value) {
  return (
    typeof value === "string" &&
    Array.from(value).length <= TAG_LIMITS.maxTagCodePoints &&
    normalizeTag(value) === value
  );
}

/**
 * Preserve a platform label for explanation/display without treating it as a
 * normalized tag. Native labels retain case and a leading hashtag.
 *
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeNativeTag(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeUnicodeText(value);
  if (!normalized) {
    return null;
  }

  const limited = sliceCodePoints(normalized, TAG_LIMITS.maxTagCodePoints).trim();
  return normalizeTag(limited) ? limited : null;
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isCanonicalNativeTag(value) {
  return typeof value === "string" && normalizeNativeTag(value) === value;
}

/**
 * Canonicalize, de-duplicate and deterministically order platform-native tags.
 * Equivalent labels such as #AI and ai keep one display form.
 *
 * @param {unknown} values
 * @returns {readonly string[]}
 */
export function normalizeNativeTags(values) {
  if (!Array.isArray(values)) {
    return Object.freeze([]);
  }

  /** @type {Map<string, string>} */
  const byNormalizedTag = new Map();
  for (const value of values) {
    const nativeTag = normalizeNativeTag(value);
    const normalizedTag = normalizeTag(nativeTag);
    if (nativeTag && normalizedTag && !byNormalizedTag.has(normalizedTag)) {
      byNormalizedTag.set(normalizedTag, nativeTag);
    }
  }

  return Object.freeze(
    [...byNormalizedTag.entries()]
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        return compareText(leftKey, rightKey) || compareText(leftValue, rightValue);
      })
      .slice(0, TAG_LIMITS.maxNativeTags)
      .map(([, nativeTag]) => nativeTag)
  );
}

/**
 * Extract site-independent local tags from a query or candidate title.
 *
 * @param {unknown} value
 * @returns {readonly string[]}
 */
export function extractLocalTags(value) {
  if (typeof value !== "string") {
    return Object.freeze([]);
  }

  const source = sliceCodePoints(
    normalizeUnicodeText(value),
    TAG_LIMITS.maxSourceCodePoints
  );
  if (!source) {
    return Object.freeze([]);
  }

  const tags = new Set();
  for (const match of source.matchAll(HASHTAG_PATTERN)) {
    const tag = normalizeTag(match[1]);
    if (tag) {
      tags.add(tag);
    }
  }

  const sourceWithoutHashtags = source.replace(HASHTAG_PATTERN, " ");
  for (const match of sourceWithoutHashtags.matchAll(LOCAL_TOKEN_PATTERN)) {
    const tag = normalizeTag(match[0]);
    if (tag) {
      tags.add(tag);
    }
  }

  return Object.freeze(
    [...tags].sort(compareText).slice(0, TAG_LIMITS.maxTags)
  );
}

function requireIdentifier(value, fieldName) {
  if (typeof value !== "string" || !value) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }
  return value;
}

/**
 * @param {{sessionId: string, query: unknown}} input
 * @returns {Readonly<import("./types.js").ContextTagProfileV1>}
 */
export function createContextTagProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Context tag profile input must be an object.");
  }

  return Object.freeze({
    sessionId: requireIdentifier(input.sessionId, "sessionId"),
    normalizedTags: extractLocalTags(input.query)
  });
}

/**
 * Aggregate the tag profiles of the Candidates a user actually selected.
 * A tag repeated across several selected Candidates receives a higher
 * frequency weight. With no selected Candidate the profile is explicitly
 * empty, never absent.
 *
 * @param {{sessionId: string, selectedProfiles?: unknown}} input
 * @returns {Readonly<import("./types.js").SessionSelectedTagProfileV1>}
 */
export function createSessionSelectedTagProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Selected tag profile input must be an object.");
  }

  const sessionId = requireIdentifier(input.sessionId, "sessionId");
  const profiles = Array.isArray(input.selectedProfiles)
    ? input.selectedProfiles
    : [];

  /** @type {Map<string, number>} */
  const candidateCountByTag = new Map();
  const countedCandidateIds = new Set();
  for (const profile of profiles) {
    if (
      !profile ||
      typeof profile !== "object" ||
      Array.isArray(profile) ||
      profile.sessionId !== sessionId ||
      typeof profile.candidateId !== "string" ||
      !profile.candidateId ||
      countedCandidateIds.has(profile.candidateId) ||
      !Array.isArray(profile.normalizedTags)
    ) {
      continue;
    }

    countedCandidateIds.add(profile.candidateId);
    const seenInCandidate = new Set();
    for (const tag of profile.normalizedTags) {
      const normalizedTag = normalizeTag(tag);
      if (normalizedTag === null || seenInCandidate.has(normalizedTag)) {
        continue;
      }
      seenInCandidate.add(normalizedTag);
      candidateCountByTag.set(
        normalizedTag,
        (candidateCountByTag.get(normalizedTag) ?? 0) + 1
      );
    }
  }

  const selectedCandidateCount = countedCandidateIds.size;
  if (selectedCandidateCount === 0) {
    return Object.freeze({
      sessionId,
      selectedCandidateCount: 0,
      tags: Object.freeze([])
    });
  }

  const tags = [...candidateCountByTag.entries()]
    .sort(([leftTag, leftCount], [rightTag, rightCount]) => {
      return rightCount - leftCount || compareText(leftTag, rightTag);
    })
    .slice(0, TAG_LIMITS.maxTags)
    .map(([tag, candidateCount]) =>
      Object.freeze({
        tag,
        candidateCount,
        weight: candidateCount / selectedCandidateCount
      })
    );

  return Object.freeze({
    sessionId,
    selectedCandidateCount,
    tags: Object.freeze(tags)
  });
}

/**
 * @param {{candidateId: string, sessionId: string, title: unknown, nativeTags?: unknown}} input
 * @returns {Readonly<import("./types.js").CandidateTagProfileV1>}
 */
export function createCandidateTagProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Candidate tag profile input must be an object.");
  }

  const nativeTags = normalizeNativeTags(input.nativeTags ?? []);
  const normalizedTags = new Set();
  for (const nativeTag of nativeTags) {
    const normalizedTag = normalizeTag(nativeTag);
    if (normalizedTag) {
      normalizedTags.add(normalizedTag);
    }
  }
  for (const localTag of extractLocalTags(input.title)) {
    if (normalizedTags.size >= TAG_LIMITS.maxTags) {
      break;
    }
    normalizedTags.add(localTag);
  }

  return Object.freeze({
    candidateId: requireIdentifier(input.candidateId, "candidateId"),
    sessionId: requireIdentifier(input.sessionId, "sessionId"),
    nativeTags,
    normalizedTags: Object.freeze(
      [...normalizedTags].sort(compareText)
    )
  });
}
