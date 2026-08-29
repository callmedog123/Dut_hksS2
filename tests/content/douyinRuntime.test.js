// @ts-check

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDouyinRuntime, DouyinRuntimeError } from "../../content/douyinRuntime.js";

class EventTargetHarness {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }
}

function createMinimalDocument() {
  return {
    location: { href: "https://www.douyin.com/search/test" },
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelectorAll: () => [],
    querySelector: () => null,
    documentElement: null,
    body: null
  };
}

describe("DouyinRuntime", () => {
  it("should create runtime with Douyin label", () => {
    const mockSendMessage = (message, callback) => {
      callback({ ok: true });
    };
    const runtime = createDouyinRuntime({
      document: createMinimalDocument(),
      MutationObserver: undefined,
      pageLifecycle: new EventTargetHarness(),
      runtime: { sendMessage: mockSendMessage },
      createAdapter: () => ({
        canHandle: () => true,
        getContext: () => ({ query: "test", source: "douyin-search", timestamp: 0 }),
        extractCandidates: () => [],
        observeChanges: () => () => {}
      })
    });
    assert.ok(runtime);
    assert.strictEqual(typeof runtime.start, "function");
  });

  it("should throw TypeError for non-object options", () => {
    assert.throws(() => createDouyinRuntime(null), TypeError);
    assert.throws(() => createDouyinRuntime("invalid"), TypeError);
  });

  it("should export DouyinRuntimeError", () => {
    const error = new DouyinRuntimeError("test", new Error("cause"));
    assert.strictEqual(error.name, "DouyinRuntimeError");
    assert.strictEqual(error.message, "test");
  });
});
