// @ts-check

import {
  CONTENT_TYPES,
  LAYOUT_TYPES
} from "../../shared/types.js";
import { normalizeCandidateUrl } from "../../shared/url.js";
import { createCandidateBindingRegistry } from "../candidateBinding.js";

const RESULT_CARD_SELECTOR = [
  '[data-za-detail-view-path-module="AnswerItem"]',
  '[data-za-detail-view-path-module="PostItem"]',
  '[data-za-detail-view-path-module="Content"]'
].join(",");
const TITLE_LINK_SELECTOR = ".ContentItem-title a[href]";
const AD_MARKER_ATTRIBUTE = "data-za-detail-view-path-is_ad";
const MODULE_ATTRIBUTE = "data-za-detail-view-path-module";

const SEARCH_HOSTNAME = "www.zhihu.com";
const ARTICLE_HOSTNAME = "zhuanlan.zhihu.com";
const SEARCH_PATHNAME = "/search";
const SOURCE = "zhihu-search";
const ANSWER_PATH_PATTERN = /^\/question\/(\d+)\/answer\/(\d+)\/?$/u;
const QUESTION_PATH_PATTERN = /^\/question\/(\d+)\/?$/u;
const ARTICLE_PATH_PATTERN = /^\/p\/(\d+)\/?$/u;

let fallbackSessionSequence = 0;

function createDefaultSessionId() {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (typeof randomUuid === "function") {
    return `${SOURCE}:${randomUuid.call(globalThis.crypto)}`;
  }

  fallbackSessionSequence += 1;
  return `${SOURCE}:${Date.now()}:${fallbackSessionSequence}`;
}

/**
 * @param {Document} document
 * @returns {URL | null}
 */
function readDocumentUrl(document) {
  const href = document?.location?.href ?? document?.baseURI;
  try {
    return typeof href === "string" ? new URL(href) : null;
  } catch {
    return null;
  }
}

/**
 * @param {URL | null} url
 * @returns {string}
 */
function readQuery(url) {
  return url?.searchParams.get("q")?.trim() ?? "";
}

/**
 * Zhihu treats a missing type as the ordinary content search. Other search
 * tabs share the same pathname but are explicitly outside this Adapter.
 *
 * @param {URL | null} url
 * @returns {boolean}
 */
function isSupportedSearchUrl(url) {
  const searchType = url?.searchParams.get("type");
  return Boolean(
    url?.protocol === "https:" &&
      url.hostname === SEARCH_HOSTNAME &&
      url.pathname === SEARCH_PATHNAME &&
      readQuery(url) &&
      (searchType === null || searchType === "content")
  );
}

/**
 * @param {Document} document
 * @returns {string}
 */
function readContextKey(document) {
  const url = readDocumentUrl(document);
  return isSupportedSearchUrl(url) ? `${SOURCE}:${readQuery(url)}` : "";
}

/**
 * Reject explicit advertisements without reading or persisting Zhihu's
 * opaque analytics payloads. Ancestor traversal covers markers placed on a
 * wrapper instead of the semantic result card.
 *
 * @param {Element} card
 * @returns {boolean}
 */
function isAdvertisement(card) {
  let current = card;
  while (current && typeof current.getAttribute === "function") {
    if (current.getAttribute(AD_MARKER_ATTRIBUTE) === "true") {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

/**
 * Rebuild permanent URLs from stable IDs before using the shared URL
 * normalizer. This removes Zhihu-only navigation parameters such as `zpf`
 * without introducing another general URL-normalization implementation.
 *
 * @param {Element} card
 * @param {Document} document
 * @returns {{id: string, url: string, contentType: import("../../shared/types.js").ContentTypeV1} | null}
 */
function readCandidateIdentity(card, document) {
  if (isAdvertisement(card)) {
    return null;
  }

  const moduleName = card.getAttribute(MODULE_ATTRIBUTE);
  let titleLink;
  try {
    titleLink = card.querySelector(TITLE_LINK_SELECTOR);
  } catch {
    return null;
  }
  const href = titleLink?.getAttribute("href");
  const baseUrl = readDocumentUrl(document);
  if (!href || baseUrl === null) {
    return null;
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(href, baseUrl);
  } catch {
    return null;
  }

  let id;
  let permanentUrl;
  let contentType;
  if (moduleName === "AnswerItem") {
    const match = ANSWER_PATH_PATTERN.exec(parsedUrl.pathname);
    if (parsedUrl.hostname !== SEARCH_HOSTNAME || match === null) {
      return null;
    }
    id = `zhihu:answer:${match[2]}`;
    permanentUrl = `https://${SEARCH_HOSTNAME}/question/${match[1]}/answer/${match[2]}`;
    contentType = CONTENT_TYPES.ANSWER;
  } else if (moduleName === "PostItem") {
    const match = ARTICLE_PATH_PATTERN.exec(parsedUrl.pathname);
    if (parsedUrl.hostname !== ARTICLE_HOSTNAME || match === null) {
      return null;
    }
    id = `zhihu:article:${match[1]}`;
    permanentUrl = `https://${ARTICLE_HOSTNAME}/p/${match[1]}`;
    contentType = CONTENT_TYPES.ARTICLE;
  } else if (moduleName === "Content") {
    const match = QUESTION_PATH_PATTERN.exec(parsedUrl.pathname);
    if (parsedUrl.hostname !== SEARCH_HOSTNAME || match === null) {
      return null;
    }
    id = `zhihu:question:${match[1]}`;
    permanentUrl = `https://${SEARCH_HOSTNAME}/question/${match[1]}`;
    contentType = CONTENT_TYPES.QUESTION;
  } else {
    return null;
  }

  const normalizedUrl = normalizeCandidateUrl(permanentUrl);
  return normalizedUrl === null
    ? null
    : { id, url: normalizedUrl, contentType };
}

/**
 * @param {{
 *   document?: Document,
 *   MutationObserver?: typeof MutationObserver,
 *   now?: () => number,
 *   sessionIdFactory?: (contextKey: string) => string,
 *   onCandidateBound?: (binding: import("./types.js").CandidateBinding) => void,
 *   onCandidateUnbound?: (binding: import("./types.js").CandidateBinding) => void
 * }} [options]
 * @returns {import("./types.js").SiteAdapter}
 */
export function createZhihuSearchAdapter(options = {}) {
  const adapterDocument = options.document ?? globalThis.document;
  const MutationObserverConstructor =
    options.MutationObserver ?? globalThis.MutationObserver;
  const now = options.now ?? (() => Date.now());
  const sessionIdFactory =
    options.sessionIdFactory ?? (() => createDefaultSessionId());
  const bindingRegistry = createCandidateBindingRegistry({
    onBound: options.onCandidateBound,
    onUnbound: options.onCandidateUnbound
  });
  let sessionContextKey = "";
  let activeSessionId = "";

  /**
   * @param {Document} document
   * @returns {string}
   */
  function getSessionId(document) {
    const contextKey = readContextKey(document);
    if (!contextKey) {
      return "";
    }
    if (contextKey === sessionContextKey) {
      return activeSessionId;
    }

    const sessionId = sessionIdFactory(contextKey)?.trim();
    if (!sessionId) {
      return "";
    }
    sessionContextKey = contextKey;
    activeSessionId = sessionId;
    return activeSessionId;
  }

  /**
   * @param {URL} url
   * @param {Document} _document
   * @returns {boolean}
   */
  function canHandle(url, _document) {
    return url instanceof URL && isSupportedSearchUrl(url);
  }

  /**
   * @param {Document} _document
   * @param {URL} url
   * @returns {import("./types.js").SearchContext}
   */
  function getContext(_document, url) {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) {
      throw new TypeError("Zhihu SearchContext clock must be finite.");
    }

    const query = readQuery(url);
    const keywords = query.split(/\s+/u).filter(Boolean);
    return {
      query,
      source: SOURCE,
      timestamp,
      ...(keywords.length > 0 ? { keywords } : {})
    };
  }

  /**
   * @param {Document} document
   * @returns {import("./types.js").CandidateBinding[]}
   */
  function scanCandidateBindings(document) {
    const sessionId = getSessionId(document);
    if (!sessionId) {
      return [];
    }

    let resultCards;
    try {
      resultCards = [...document.querySelectorAll(RESULT_CARD_SELECTOR)];
    } catch {
      return [];
    }

    const seenIds = new Set();
    const seenUrls = new Set();
    const bindings = [];
    resultCards.forEach((card, index) => {
      try {
        const title = card
          .querySelector(TITLE_LINK_SELECTOR)
          ?.textContent?.replace(/\s+/gu, " ")
          .trim();
        const identity = readCandidateIdentity(card, document);
        if (
          !title ||
          identity === null ||
          seenIds.has(identity.id) ||
          seenUrls.has(identity.url)
        ) {
          return;
        }

        seenIds.add(identity.id);
        seenUrls.add(identity.url);
        bindings.push({
          candidate: {
            id: identity.id,
            url: identity.url,
            title,
            source: SOURCE,
            rank: index + 1,
            sessionId,
            contentType: identity.contentType,
            layoutType: LAYOUT_TYPES.TEXT_LIST
          },
          element: card
        });
      } catch {
        // Malformed, partially rendered and selector-error cards are isolated.
      }
    });
    return bindings;
  }

  /**
   * @param {Document} document
   * @returns {import("./types.js").Candidate[]}
   */
  function extractCandidates(document) {
    const bindings = scanCandidateBindings(document);
    bindingRegistry.sync(bindings);
    return bindings.map((binding) => binding.candidate);
  }

  /**
   * @param {() => void} onCandidatesChanged
   * @returns {() => void}
   */
  function observeChanges(onCandidatesChanged) {
    if (typeof onCandidatesChanged !== "function") {
      throw new TypeError("onCandidatesChanged must be a function.");
    }

    const observerTarget = adapterDocument?.documentElement ?? adapterDocument?.body;
    if (observerTarget === null || observerTarget === undefined) {
      bindingRegistry.clear();
      return () => {};
    }
    if (typeof MutationObserverConstructor !== "function") {
      throw new TypeError("MutationObserver is unavailable.");
    }

    let activeContextKey = readContextKey(adapterDocument);
    const initialCandidates = extractCandidates(adapterDocument);
    let knownIds = new Set(initialCandidates.map((candidate) => candidate.id));
    let knownUrls = new Set(
      initialCandidates.map((candidate) => candidate.url)
    );
    let disposed = false;

    const observer = new MutationObserverConstructor(() => {
      if (disposed) {
        return;
      }

      const currentContextKey = readContextKey(adapterDocument);
      if (currentContextKey !== activeContextKey) {
        bindingRegistry.clear();
        activeContextKey = currentContextKey;
        const nextBindings = scanCandidateBindings(adapterDocument);
        knownIds = new Set(
          nextBindings.map((binding) => binding.candidate.id)
        );
        knownUrls = new Set(
          nextBindings.map((binding) => binding.candidate.url)
        );
        onCandidatesChanged();
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
    observer.observe(observerTarget, { childList: true, subtree: true });

    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      observer.disconnect();
      bindingRegistry.clear();
    };
  }

  return Object.freeze({
    canHandle,
    getContext,
    extractCandidates,
    observeChanges
  });
}
