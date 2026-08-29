// @ts-check

import { normalizeCandidateUrl } from "../../shared/url.js";
import { CONTENT_TYPES, LAYOUT_TYPES } from "../../shared/types.js";
import { createCandidateBindingRegistry } from "../candidateBinding.js";

const RESULTS_ROOT_SELECTOR = ".video-list";
const RESULT_CARD_SELECTOR = ".bili-video-card";
const TITLE_SELECTOR = ".bili-video-card__info--tit";
const VIDEO_LINK_SELECTOR = 'a[href*="/video/"]';

const SEARCH_HOSTNAME = "search.bilibili.com";
const VIDEO_HOSTNAME = "www.bilibili.com";
const SOURCE = "bilibili-search";
const VIDEO_PATH_PATTERN = /^\/video\/(BV[0-9A-Za-z]+)\/?$/;

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
  return url?.searchParams.get("keyword")?.trim() ?? "";
}

/**
 * Search query is the session boundary. Pagination and result-list mutations
 * remain part of the same search session, while SPA query changes do not.
 *
 * @param {Document} document
 * @returns {string}
 */
function readContextKey(document) {
  const url = readDocumentUrl(document);
  const query = readQuery(url);
  return url?.protocol === "https:" &&
    url.hostname === SEARCH_HOSTNAME &&
    query
    ? `${SOURCE}:${query}`
    : "";
}

/**
 * @param {Element} card
 * @param {Document} document
 * @returns {{id: string, url: string} | null}
 */
function readVideoIdentity(card, document) {
  const baseUrl = readDocumentUrl(document);
  let links;
  try {
    links = [...card.querySelectorAll(VIDEO_LINK_SELECTOR)];
  } catch {
    return null;
  }

  for (const link of links) {
    const href = link.getAttribute("href");
    if (!href) {
      continue;
    }

    const normalizedUrl = normalizeCandidateUrl(
      href,
      baseUrl ?? undefined
    );
    if (normalizedUrl === null) {
      continue;
    }

    try {
      const parsedUrl = new URL(normalizedUrl);
      const videoMatch = VIDEO_PATH_PATTERN.exec(parsedUrl.pathname);
      if (parsedUrl.hostname === VIDEO_HOSTNAME && videoMatch !== null) {
        return { id: videoMatch[1], url: normalizedUrl };
      }
    } catch {
      // normalizeCandidateUrl already guards parsing; keep extraction defensive.
    }
  }

  return null;
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
export function createBilibiliSearchAdapter(options = {}) {
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
    return Boolean(
      url instanceof URL &&
        url.protocol === "https:" &&
        url.hostname === SEARCH_HOSTNAME &&
        readQuery(url)
    );
  }

  /**
   * @param {Document} _document
   * @param {URL} url
   * @returns {import("./types.js").SearchContext}
   */
  function getContext(_document, url) {
    const timestamp = now();
    if (!Number.isFinite(timestamp)) {
      throw new TypeError("Bilibili SearchContext clock must be finite.");
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
      const resultsRoot = document.querySelector(RESULTS_ROOT_SELECTOR);
      if (resultsRoot === null) {
        return [];
      }
      resultCards = [...resultsRoot.querySelectorAll(RESULT_CARD_SELECTOR)];
    } catch {
      return [];
    }

    const seenIds = new Set();
    const seenUrls = new Set();
    const bindings = [];

    resultCards.forEach((card, index) => {
      try {
        const title = card
          .querySelector(TITLE_SELECTOR)
          ?.textContent?.replace(/\s+/gu, " ")
          .trim();
        const identity = readVideoIdentity(card, document);

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
        const candidate = {
          id: identity.id,
          url: identity.url,
          title,
          source: SOURCE,
          rank: index + 1,
          sessionId,
          contentType: CONTENT_TYPES.VIDEO,
          layoutType: LAYOUT_TYPES.GRID
        };
        bindings.push({ candidate, element: card });
      } catch {
        // A malformed or partially rendered card must not stop the page scan.
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

    const observerTarget =
      adapterDocument?.documentElement ??
      adapterDocument?.body ??
      adapterDocument?.querySelector?.(RESULTS_ROOT_SELECTOR);
    if (observerTarget === null || observerTarget === undefined) {
      bindingRegistry.clear();
      return () => {};
    }
    if (typeof MutationObserverConstructor !== "function") {
      throw new TypeError("MutationObserver is unavailable.");
    }

    let activeContextKey = readContextKey(adapterDocument);
    const initialCandidates = extractCandidates(adapterDocument);
    let knownIds = new Set(
      initialCandidates.map((candidate) => candidate.id)
    );
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
        // Give the Runtime a clean boundary: unbind the old Session first and
        // let it finalize before a later extraction binds the new SPA context.
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
