import assert from "node:assert/strict";
import test from "node:test";

import {
  AdapterConflictError,
  createRealSiteAdapterRegistry,
  createSiteAdapterRegistry
} from "../../content/adapters/registry.js";
import { createBilibiliDocumentFixture } from "./fixtures/bilibiliDom.js";
import { createZhihuDocumentFixture } from "./fixtures/zhihuDom.js";

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

test("real-site registry matches only approved Bilibili and Zhihu searches", () => {
  const fixture = createBilibiliDocumentFixture();
  const zhihuFixture = createZhihuDocumentFixture();
  const registry = createRealSiteAdapterRegistry({
    document: fixture.document,
    sessionIdFactory: () => "registry-session"
  });

  assert.notEqual(
    registry.resolve(
      new URL("https://search.bilibili.com/all?keyword=robotics"),
      fixture.document
    ),
    null
  );
  assert.equal(
    registry.resolve(
      new URL("https://search.bilibili.com/all"),
      fixture.document
    ),
    null
  );
  assert.equal(
    registry.resolve(
      new URL("https://www.bilibili.com/?keyword=robotics"),
      fixture.document
    ),
    null
  );
  assert.notEqual(
    registry.resolve(
      new URL("https://www.zhihu.com/search?type=content&q=robotics"),
      zhihuFixture.document
    ),
    null
  );
  assert.equal(
    registry.resolve(
      new URL("https://www.zhihu.com/search?type=people&q=robotics"),
      zhihuFixture.document
    ),
    null
  );
  assert.equal(
    registry.resolve(
      new URL("https://zhuanlan.zhihu.com/p/123"),
      zhihuFixture.document
    ),
    null
  );
  assert.equal(
    registry.resolve(
      new URL("https://example.com/search?keyword=robotics"),
      fixture.document
    ),
    null
  );
});
