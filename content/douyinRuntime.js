// @ts-check

import { createDouyinSearchAdapter } from "./adapters/douyinSearchAdapter.js";
import { SiteRuntimeError, createSiteRuntime } from "./siteRuntime.js";

export class DouyinRuntimeError extends SiteRuntimeError {
  constructor(message, cause) {
    super(message, cause);
    this.name = "DouyinRuntimeError";
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Thin site wrapper: all binding, signal, checkpoint and finalization behavior
 * remains in the shared Site Runtime.
 *
 * @param {Parameters<typeof createSiteRuntime>[0]} [options]
 */
export function createDouyinRuntime(options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("Douyin Runtime options must be an object.");
  }

  return createSiteRuntime({
    ...options,
    siteLabel: "Douyin",
    RuntimeError: DouyinRuntimeError,
    createAdapter(adapterOptions) {
      return createDouyinSearchAdapter(adapterOptions);
    }
  });
}

export function startDouyinRuntime(options = {}) {
  const runtime = createDouyinRuntime(options);
  void runtime.start();
  return runtime;
}
