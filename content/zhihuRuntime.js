// @ts-check

import { createZhihuSearchAdapter } from "./adapters/zhihuSearchAdapter.js";
import { SiteRuntimeError, createSiteRuntime } from "./siteRuntime.js";

export class ZhihuRuntimeError extends SiteRuntimeError {
  constructor(message, cause) {
    super(message, cause);
    this.name = "ZhihuRuntimeError";
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
export function createZhihuRuntime(options = {}) {
  if (!isRecord(options)) {
    throw new TypeError("Zhihu Runtime options must be an object.");
  }

  return createSiteRuntime({
    ...options,
    siteLabel: "Zhihu",
    RuntimeError: ZhihuRuntimeError,
    createAdapter(adapterOptions) {
      return createZhihuSearchAdapter(adapterOptions);
    }
  });
}

export function startZhihuRuntime(options = {}) {
  const runtime = createZhihuRuntime(options);
  void runtime.start();
  return runtime;
}
