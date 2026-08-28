// @ts-check

import { createBilibiliSearchAdapter } from "./adapters/bilibiliSearchAdapter.js";
import {
  SiteRuntimeError,
  createSiteRuntime
} from "./siteRuntime.js";

export class BilibiliRuntimeError extends SiteRuntimeError {
  constructor(message, cause) {
    super(message, cause);
    this.name = "BilibiliRuntimeError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Preserve the existing Bilibili Runtime API while delegating all
 * site-independent orchestration to the shared Site Runtime.
 *
 * @param {{
 *   document?: Document,
 *   pageLifecycle?: EventTarget,
 *   runtime?: object,
 *   sendMessage?: (message: object) => unknown,
 *   readUrl?: () => URL,
 *   wallNow?: () => number,
 *   performanceNow?: () => number,
 *   MutationObserver?: typeof MutationObserver,
 *   IntersectionObserver?: typeof IntersectionObserver,
 *   sessionIdFactory?: (contextKey: string) => string,
 *   eventFactory?: (type: string) => Event,
 *   onStatus?: (status: {state: string, message: string, data?: unknown}) => void
 * }} [options]
 */
export function createBilibiliRuntime(options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("Bilibili Runtime options must be an object.");
  }

  return createSiteRuntime({
    ...options,
    siteLabel: "Bilibili",
    RuntimeError: BilibiliRuntimeError,
    createAdapter(adapterOptions) {
      return createBilibiliSearchAdapter(adapterOptions);
    }
  });
}

export function startBilibiliRuntime(options = {}) {
  const runtime = createBilibiliRuntime(options);
  void runtime.start();
  return runtime;
}
