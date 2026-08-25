// @ts-check

import { normalizeCandidateUrl } from "../../shared/url.js";

const DEMO_PAGE_SELECTOR = "[data-demo-search-page]";
const RESULTS_SELECTOR = "[data-demo-results]";
const RESULT_SELECTOR = "[data-demo-result]";
const TITLE_SELECTOR = "[data-demo-title]";
const LINK_SELECTOR = "[data-demo-link]";

const DEMO_PAGE_PATH = "/demo/index.html";
const SOURCE_ATTRIBUTE = "data-demo-source";
const SESSION_ID_ATTRIBUTE = "data-demo-session-id";
const QUERY_ATTRIBUTE = "data-demo-query";
const TIMESTAMP_ATTRIBUTE = "data-demo-timestamp";
const KEYWORDS_ATTRIBUTE = "data-demo-keywords";
const CANDIDATE_ID_ATTRIBUTE = "data-candidate-id";

/**
 * @param {Element | null} element
 * @param {string} attribute
 * @returns {string}
 */
function readTrimmedAttribute(element, attribute) {
  return element?.getAttribute(attribute)?.trim() ?? "";
}

/**
 * @param {Document} document
 * @returns {Element | null}
 */
function findDemoPage(document) {
  return document.querySelector(DEMO_PAGE_SELECTOR);
}

/**
 * @param {{
 *   document?: Document,
 *   MutationObserver?: typeof MutationObserver
 * }} [options]
 * @returns {import("./types.js").SiteAdapter}
 */
export function createDemoAdapter(options = {}) {
  const adapterDocument = options.document ?? globalThis.document;
  const MutationObserverConstructor =
    options.MutationObserver ?? globalThis.MutationObserver;

  /**
   * @param {URL} url
   * @param {Document} document
   * @returns {boolean}
   */
  function canHandle(url, document) {
    return Boolean(
      url instanceof URL &&
        url.protocol === "chrome-extension:" &&
        url.pathname === DEMO_PAGE_PATH &&
        findDemoPage(document)
    );
  }

  /**
   * @param {Document} document
   * @param {URL} _url
   * @returns {import("./types.js").SearchContext}
   */
  function getContext(document, _url) {
    const page = findDemoPage(document);
    if (page === null) {
      throw new TypeError("Demo search page root is missing.");
    }

    const query = readTrimmedAttribute(page, QUERY_ATTRIBUTE);
    const source = readTrimmedAttribute(page, SOURCE_ATTRIBUTE);
    const timestamp = Number(page.getAttribute(TIMESTAMP_ATTRIBUTE));
    const keywords = readTrimmedAttribute(page, KEYWORDS_ATTRIBUTE)
      .split(",")
      .map((keyword) => keyword.trim())
      .filter(Boolean);

    if (!query || !source || !Number.isFinite(timestamp)) {
      throw new TypeError("Demo SearchContext attributes are invalid.");
    }

    return {
      query,
      source,
      timestamp,
      ...(keywords.length > 0 ? { keywords } : {})
    };
  }

  /**
   * @param {Document} document
   * @returns {import("./types.js").Candidate[]}
   */
  function extractCandidates(document) {
    const page = findDemoPage(document);
    const resultsRoot = document.querySelector(RESULTS_SELECTOR);
    if (page === null || resultsRoot === null) {
      return [];
    }

    const source = readTrimmedAttribute(page, SOURCE_ATTRIBUTE);
    const sessionId = readTrimmedAttribute(page, SESSION_ID_ATTRIBUTE);
    if (!source || !sessionId) {
      return [];
    }

    const seenIds = new Set();
    const seenUrls = new Set();
    const candidates = [];
    const resultNodes = [...resultsRoot.querySelectorAll(RESULT_SELECTOR)];

    resultNodes.forEach((resultNode, index) => {
      const id = readTrimmedAttribute(resultNode, CANDIDATE_ID_ATTRIBUTE);
      const title = resultNode.querySelector(TITLE_SELECTOR)?.textContent?.trim();
      const href = resultNode.querySelector(LINK_SELECTOR)?.getAttribute("href");

      if (!id || !title || !href) {
        return;
      }

      const url = normalizeCandidateUrl(href, document.baseURI);
      if (url === null || seenIds.has(id) || seenUrls.has(url)) {
        return;
      }

      seenIds.add(id);
      seenUrls.add(url);
      candidates.push({
        id,
        url,
        title,
        source,
        rank: index + 1,
        sessionId
      });
    });

    return candidates;
  }

  /**
   * @param {() => void} onCandidatesChanged
   * @returns {() => void}
   */
  function observeChanges(onCandidatesChanged) {
    if (typeof onCandidatesChanged !== "function") {
      throw new TypeError("onCandidatesChanged must be a function.");
    }

    const resultsRoot = adapterDocument?.querySelector(RESULTS_SELECTOR);
    if (resultsRoot === null || resultsRoot === undefined) {
      return () => {};
    }

    if (typeof MutationObserverConstructor !== "function") {
      throw new TypeError("MutationObserver is unavailable.");
    }

    const initialCandidates = extractCandidates(adapterDocument);
    const knownIds = new Set(initialCandidates.map((candidate) => candidate.id));
    const knownUrls = new Set(
      initialCandidates.map((candidate) => candidate.url)
    );
    let disposed = false;

    const observer = new MutationObserverConstructor(() => {
      if (disposed) {
        return;
      }

      const currentCandidates = extractCandidates(adapterDocument);
      const newCandidates = currentCandidates.filter(
        (candidate) =>
          !knownIds.has(candidate.id) && !knownUrls.has(candidate.url)
      );

      if (newCandidates.length === 0) {
        return;
      }

      for (const candidate of newCandidates) {
        knownIds.add(candidate.id);
        knownUrls.add(candidate.url);
      }
      onCandidatesChanged();
    });

    observer.observe(resultsRoot, { childList: true, subtree: true });

    return () => {
      if (disposed) {
        return;
      }

      disposed = true;
      observer.disconnect();
    };
  }

  return Object.freeze({
    canHandle,
    getContext,
    extractCandidates,
    observeChanges
  });
}
