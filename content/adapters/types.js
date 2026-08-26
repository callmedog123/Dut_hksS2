// @ts-check

/** @typedef {import("../../shared/types.js").CandidateV1} Candidate */
/** @typedef {import("../../shared/types.js").SearchContextV1} SearchContext */

/**
 * Page-memory-only association between a shared Candidate and its card.
 * Element must never be serialized into messages or Repository records.
 *
 * @typedef {object} CandidateBinding
 * @property {Candidate} candidate
 * @property {Element} element
 */

/**
 * Site boundary for translating supported result pages into shared data.
 * Implementations own their DOM selectors; consumers only use this contract.
 *
 * @typedef {object} SiteAdapter
 * @property {(url: URL, document: Document) => boolean} canHandle
 * @property {(document: Document, url: URL) => SearchContext} getContext
 * @property {(document: Document) => Candidate[]} extractCandidates
 * @property {(onCandidatesChanged: () => void) => (() => void)} observeChanges
 */

const REQUIRED_METHODS = Object.freeze([
  "canHandle",
  "getContext",
  "extractCandidates",
  "observeChanges"
]);

/**
 * Fail early when a registry receives an object that does not implement the
 * shared SiteAdapter contract.
 *
 * @param {unknown} adapter
 * @param {number} index
 * @returns {asserts adapter is SiteAdapter}
 */
export function assertSiteAdapter(adapter, index) {
  if (typeof adapter !== "object" || adapter === null) {
    throw new TypeError(`Adapter at index ${index} must be an object.`);
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== "function") {
      throw new TypeError(
        `Adapter at index ${index} must implement ${method}().`
      );
    }
  }
}
