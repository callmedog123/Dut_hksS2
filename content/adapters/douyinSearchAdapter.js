// @ts-check

import {
  CONTENT_TYPES,
  LAYOUT_TYPES
} from "../../shared/types.js";
import { normalizeCandidateUrl } from "../../shared/url.js";
import { createCandidateBindingRegistry } from "../candidateBinding.js";

const RESULT_CARD_SELECTOR = '[id^="waterfall_item_"]';
const TITLE_SELECTOR = ".search-result-card";

const SEARCH_HOSTNAME = "www.douyin.com";
const SEARCH_PATHNAME = "/search";
const SOURCE = "douyin-search";
const VIDEO_PATH_PATTERN = /^\/video\/(\d+)\/?$/u;
const NOTE_PATH_PATTERN = /^\/note\/(\d+)\/?$/u;

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
  if (!url || !url.pathname.startsWith(SEARCH_PATHNAME)) {
    return "";
  }
  // Douyin search query is in pathname: /search/<encoded_query>
  const pathPart = url.pathname.slice(SEARCH_PATHNAME.length).replace(/^\//, "");
  try {
    return decodeURIComponent(pathPart).trim();
  } catch {
    return pathPart.trim();
  }
}

/**
 * @param {URL | null} url
 * @returns {boolean}
 */
function isSupportedSearchUrl(url) {
  const searchType = url?.searchParams.get("type");
  return Boolean(
    url?.protocol === "https:" &&
      url.hostname === SEARCH_HOSTNAME &&
      url.pathname.startsWith(SEARCH_PATHNAME) &&
      readQuery(url) &&
      (searchType === null || searchType === "general" || searchType === "video")
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
 * Extract numeric ID from waterfall_item_ container.
 * @param {Element} card
 * @returns {string | null}
 */
function readNumericId(card) {
  const id = card.id ?? card.getAttribute?.("id") ?? card.getAttribute?.("id");
  if (!id || !id.startsWith("waterfall_item_")) {
    return null;
  }
  const numericId = id.replace("waterfall_item_", "");
  return /^\d{19}$/.test(numericId) ? numericId : null;
}

/**
 * Determine content type from card text patterns.
 * @param {Element} card
 * @returns {import("../../shared/types.js").ContentTypeV1 | null}
 */
function readContentType(card) {
  const text = card.textContent || "";
  // Video cards have duration prefix like "02:08"
  if (/^\d{2}:\d{2}/.test(text.trim())) {
    return CONTENT_TYPES.VIDEO;
  }
  // Image post cards contain "图文" marker
  if (text.includes("图文")) {
    return CONTENT_TYPES.IMAGE_POST;
  }
  return null;
}

/**
 * Extract hashtags from card text as native tags.
 * @param {Element} card
 * @returns {string[]}
 */
function readNativeTags(card) {
  const text = card.textContent || "";
  const hashtagPattern = /#([^\s#@]+)/gu;
  const tags = [];
  let match;
  while ((match = hashtagPattern.exec(text)) !== null) {
    const tag = match[1].trim();
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags.slice(0, 10); // Limit to 10 tags
}

/**
 * @param {Element} card
 * @returns {{id: string, url: string, contentType: import("../../shared/types.js").ContentTypeV1} | null}
 */
function readCandidateIdentity(card) {
  const numericId = readNumericId(card);
  if (!numericId) {
    return null;
  }

  const contentType = readContentType(card);
  if (!contentType) {
    return null;
  }

  // Construct permanent URL based on content type
  const path = contentType === CONTENT_TYPES.VIDEO ? `/video/${numericId}` : `/note/${numericId}`;
  const permanentUrl = `https://${SEARCH_HOSTNAME}${path}`;

  const normalizedUrl = normalizeCandidateUrl(permanentUrl);
  if (normalizedUrl === null) {
    return null;
  }

  return {
    id: `douyin:${contentType.toLowerCase()}:${numericId}`,
    url: normalizedUrl,
    contentType
  };
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
export function createDouyinSearchAdapter(options = {}) {
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
      throw new TypeError("Douyin SearchContext clock must be finite.");
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
        const titleElement = card.querySelector(TITLE_SELECTOR);
        const title = titleElement?.textContent?.replace(/\s+/gu, " ").trim();
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
            layoutType: LAYOUT_TYPES.GRID
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
