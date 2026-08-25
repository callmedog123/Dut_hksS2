import assert from "node:assert/strict";
import test from "node:test";

import {
  AdapterConflictError,
  createSiteAdapterRegistry
} from "../../content/adapters/registry.js";

const testUrl = new URL("https://example.invalid/search?q=robotics");
const testDocument = {};

function createAdapter({ canHandle = false, observeChanges } = {}) {
  return {
    canHandle() {
      return canHandle;
    },
    getContext() {
      return {
        query: "robotics",
        source: "test",
        timestamp: 100
      };
    },
    extractCandidates() {
      return [];
    },
    observeChanges: observeChanges ?? (() => () => {})
  };
}

test("returns null when no adapter can handle the page", () => {
  const registry = createSiteAdapterRegistry([
    createAdapter(),
    createAdapter()
  ]);

  assert.equal(registry.resolve(testUrl, testDocument), null);
});

test("returns the only matching adapter", () => {
  const matchingAdapter = createAdapter({ canHandle: true });
  const registry = createSiteAdapterRegistry([
    createAdapter(),
    matchingAdapter,
    createAdapter()
  ]);

  assert.equal(registry.resolve(testUrl, testDocument), matchingAdapter);
});

test("throws a structured conflict when multiple adapters match", () => {
  const registry = createSiteAdapterRegistry([
    createAdapter({ canHandle: true }),
    createAdapter({ canHandle: true })
  ]);

  assert.throws(
    () => registry.resolve(testUrl, testDocument),
    (error) => {
      assert.equal(error instanceof AdapterConflictError, true);
      assert.equal(error.code, "ADAPTER_CONFLICT");
      assert.equal(error.matchCount, 2);
      return true;
    }
  );
});

test("returns an idempotent observer cleanup", () => {
  let receivedCallback;
  let cleanupCount = 0;
  const matchingAdapter = createAdapter({
    canHandle: true,
    observeChanges(onCandidatesChanged) {
      receivedCallback = onCandidatesChanged;
      return () => {
        cleanupCount += 1;
      };
    }
  });
  const registry = createSiteAdapterRegistry([matchingAdapter]);
  const onCandidatesChanged = () => {};

  const cleanup = registry.observe(
    testUrl,
    testDocument,
    onCandidatesChanged
  );
  assert.equal(receivedCallback, onCandidatesChanged);

  cleanup();
  cleanup();
  assert.equal(cleanupCount, 1);
});
