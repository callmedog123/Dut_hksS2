// @ts-check

import { assertSiteAdapter } from "./types.js";

export class AdapterConflictError extends Error {
  /**
   * @param {number} matchCount
   */
  constructor(matchCount) {
    super(`Expected at most one Site Adapter, but ${matchCount} matched.`);
    this.name = "AdapterConflictError";
    this.code = "ADAPTER_CONFLICT";
    this.matchCount = matchCount;
  }
}

/**
 * @param {import("./types.js").SiteAdapter[]} [adapters]
 */
export function createSiteAdapterRegistry(adapters = []) {
  const registeredAdapters = Object.freeze([...adapters]);
  registeredAdapters.forEach(assertSiteAdapter);

  /**
   * @param {URL} url
   * @param {Document} document
   * @returns {import("./types.js").SiteAdapter | null}
   */
  function resolve(url, document) {
    const matches = registeredAdapters.filter((adapter) =>
      adapter.canHandle(url, document)
    );

    if (matches.length === 0) {
      return null;
    }

    if (matches.length > 1) {
      throw new AdapterConflictError(matches.length);
    }

    return matches[0];
  }

  /**
   * Resolve the current page and start its adapter observer. The returned
   * cleanup is idempotent so callers can safely dispose during repeated
   * navigation/unmount paths.
   *
   * @param {URL} url
   * @param {Document} document
   * @param {() => void} onCandidatesChanged
   * @returns {() => void}
   */
  function observe(url, document, onCandidatesChanged) {
    if (typeof onCandidatesChanged !== "function") {
      throw new TypeError("onCandidatesChanged must be a function.");
    }

    const adapter = resolve(url, document);
    if (adapter === null) {
      return () => {};
    }

    const cleanup = adapter.observeChanges(onCandidatesChanged);
    if (typeof cleanup !== "function") {
      throw new TypeError("SiteAdapter.observeChanges() must return cleanup.");
    }

    let disposed = false;
    return () => {
      if (disposed) {
        return;
      }

      disposed = true;
      cleanup();
    };
  }

  return Object.freeze({ resolve, observe });
}
