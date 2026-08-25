// @ts-check

/**
 * A normalized result candidate emitted by a Site Adapter.
 *
 * @typedef {object} Candidate
 * @property {string} id Stable identifier within its search session.
 * @property {string} url Normalized candidate URL.
 * @property {string} title Candidate title.
 * @property {string} source Adapter-defined source identifier.
 * @property {number} rank One-based result rank.
 * @property {string} sessionId Search session identifier.
 */

/**
 * Minimal context for the search session that produced candidates.
 *
 * @typedef {object} SearchContext
 * @property {string} query
 * @property {string} source
 * @property {number} timestamp
 * @property {string[]} [keywords]
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
