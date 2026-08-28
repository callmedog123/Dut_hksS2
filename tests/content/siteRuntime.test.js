import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMessageRouter } from "../../background/messageRouter.js";
import { createSessionFinalizeUseCase } from "../../background/sessionFinalize.js";
import { createSessionManager } from "../../background/sessionManager.js";
import { createTagEnrichmentCoordinator } from "../../background/tagEnrichment.js";
import { createSiteRuntime } from "../../content/siteRuntime.js";
import {
  MESSAGE_TYPES,
  createSuccessResponseMessage
} from "../../shared/messages.js";
import { createRepository } from "../../storage/repository.js";
import { createBilibiliDocumentFixture } from "../adapters/fixtures/bilibiliDom.js";
import { createIntersectionObserverHarness } from "../adapters/fixtures/demoDom.js";
import { createTransactionalMemoryStorageAdapter } from "../storage/fixtures/memoryStorageAdapter.js";

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

function createBackend({ withTagEnrichment = false } = {}) {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const sessionManager = createSessionManager(repository);
  const tagEnrichmentCoordinator = withTagEnrichment
    ? createTagEnrichmentCoordinator(repository, null)
    : null;
  const router = createMessageRouter(repository, {
    sessionFinalizeUseCase: createSessionFinalizeUseCase(sessionManager),
    ...(tagEnrichmentCoordinator === null ? {} : { tagEnrichmentCoordinator })
  });
  const messages = [];

  return {
    messages,
    repository,
    async sendMessage(message) {
      messages.push(message);
      if (message.type !== MESSAGE_TYPES.CANDIDATE_CHOSEN) {
        return router.route(message);
      }
      const candidateChosen = await sessionManager.recordCandidateChosen(
        message.payload.sessionId,
        message.payload.candidateId,
        message.payload.chosenAt
      );
      return createSuccessResponseMessage(message.requestId, {
        candidateChosen
      });
    }
  };
}

test("generic Site Runtime composes an injected Adapter and shared collectors", async () => {
  const fixture = createBilibiliDocumentFixture({
    url: "https://example.test/search?q=robotics",
    candidates: [
      {
        title: "Generic result",
        href: "https://example.test/result/1"
      }
    ]
  });
  const candidate = {
    id: "test:candidate-1",
    url: "https://example.test/result/1",
    title: "Generic result",
    source: "test-search",
    rank: 1,
    sessionId: "test-session-1"
  };
  const context = {
    query: "robotics",
    source: "test-search",
    timestamp: 100,
    keywords: ["robotics"]
  };
  const binding = { candidate, element: fixture.cards[0] };
  const backend = createBackend();
  const intersection = createIntersectionObserverHarness();
  const pageLifecycle = new EventTargetHarness();
  const statuses = [];
  let performanceTime = 0;
  let adapterCleanupCount = 0;

  const runtime = createSiteRuntime({
    document: fixture.document,
    pageLifecycle,
    siteLabel: "Test Site",
    sendMessage(message) {
      return backend.sendMessage(message);
    },
    readUrl: () => new URL(fixture.document.location.href),
    wallNow: () => 1_000,
    performanceNow: () => performanceTime,
    IntersectionObserver: intersection.IntersectionObserver,
    createAdapter({ onCandidateBound, onCandidateUnbound }) {
      return {
        canHandle(url) {
          return url.hostname === "example.test";
        },
        getContext() {
          return context;
        },
        extractCandidates() {
          return [candidate];
        },
        observeChanges() {
          onCandidateBound(binding);
          return () => {
            adapterCleanupCount += 1;
            onCandidateUnbound(binding);
          };
        }
      };
    },
    onStatus(status) {
      statuses.push(status);
    }
  });

  await runtime.start();
  await runtime.whenIdle();
  assert.equal(runtime.lifecycle, "collecting");
  assert.equal(runtime.activeSessionId, "test-session-1");
  assert.match(statuses.at(-1).message, /^Test Site Runtime/u);

  performanceTime = 100;
  fixture.cards[0].dispatchEvent({ type: "mouseenter" });
  performanceTime = 2_100;
  fixture.cards[0].dispatchEvent({ type: "mouseleave" });
  fixture.document.dispatch("click", fixture.clickTarget(0));
  await runtime.whenIdle();

  assert.equal(
    backend.messages.some(
      (message) => message.type === MESSAGE_TYPES.CANDIDATE_CHOSEN
    ),
    true
  );
  assert.equal(
    backend.messages.some(
      (message) => message.type === MESSAGE_TYPES.SIGNALS_UPDATED
    ),
    true
  );

  const finalized = await runtime.finalizeCurrentSession("通用测试");
  assert.equal(finalized.chosen.length, 1);
  assert.deepEqual(finalized.missedPaths, []);

  runtime.cleanup();
  runtime.cleanup();
  assert.equal(adapterCleanupCount, 1);
  assert.equal(fixture.document.listenerCount("click"), 0);
  assert.equal(fixture.document.listenerCount("auxclick"), 0);
});

test("Site Runtime reports native tags from an Adapter that implements extractCandidateTags()", async () => {
  const fixture = createBilibiliDocumentFixture({
    url: "https://example.test/search?q=robotics",
    candidates: [
      {
        title: "Generic result",
        href: "https://example.test/result/1"
      }
    ]
  });
  const candidate = {
    id: "test:candidate-1",
    url: "https://example.test/result/1",
    title: "Generic result",
    source: "test-search",
    rank: 1,
    sessionId: "test-session-tags"
  };
  const context = {
    query: "robotics",
    source: "test-search",
    timestamp: 100,
    keywords: ["robotics"]
  };
  const binding = { candidate, element: fixture.cards[0] };
  const backend = createBackend();
  const intersection = createIntersectionObserverHarness();
  const pageLifecycle = new EventTargetHarness();

  const runtime = createSiteRuntime({
    document: fixture.document,
    pageLifecycle,
    siteLabel: "Test Site",
    sendMessage(message) {
      return backend.sendMessage(message);
    },
    readUrl: () => new URL(fixture.document.location.href),
    wallNow: () => 1_000,
    IntersectionObserver: intersection.IntersectionObserver,
    createAdapter({ onCandidateBound, onCandidateUnbound }) {
      return {
        canHandle(url) {
          return url.hostname === "example.test";
        },
        getContext() {
          return context;
        },
        extractCandidates() {
          return [candidate];
        },
        extractCandidateTags() {
          return [
            { candidateId: "test:candidate-1", nativeTags: ["#AI", "机器人"] }
          ];
        },
        observeChanges() {
          onCandidateBound(binding);
          return () => onCandidateUnbound(binding);
        }
      };
    }
  });

  await runtime.start();
  await runtime.whenIdle();

  assert.equal(
    backend.messages.some(
      (message) => message.type === MESSAGE_TYPES.CANDIDATE_TAGS_DISCOVERED
    ),
    true
  );
  const stored = await backend.repository.getCandidateTagProfile(
    "test-session-tags",
    "test:candidate-1"
  );
  assert.notEqual(stored, null);
  assert.deepEqual(stored.nativeTags, ["#AI", "机器人"]);
  // normalizedTags merges the native tags with local tags extracted from the
  // Candidate title ("Generic result"), matching Task 7/8 behavior.
  assert.deepEqual(stored.normalizedTags, ["ai", "generic", "result", "机器人"]);

  runtime.cleanup();
});

test("real Runtime to Router to Repository persists local fallback profiles", async () => {
  const fixture = createBilibiliDocumentFixture({
    url: "https://example.test/search?q=robotics",
    candidates: [{ title: "Robotics result", href: "https://example.test/result/1" }]
  });
  const candidate = {
    id: "test:candidate-fallback",
    url: "https://example.test/result/1",
    title: "Robotics result",
    source: "test-search",
    rank: 1,
    sessionId: "test-session-fallback"
  };
  const context = {
    query: "robotics",
    source: "test-search",
    timestamp: 100,
    keywords: ["robotics"]
  };
  const binding = { candidate, element: fixture.cards[0] };
  const backend = createBackend({ withTagEnrichment: true });
  const intersection = createIntersectionObserverHarness();
  const pageLifecycle = new EventTargetHarness();
  const runtime = createSiteRuntime({
    document: fixture.document,
    pageLifecycle,
    siteLabel: "Test Site",
    sendMessage(message) {
      return backend.sendMessage(message);
    },
    readUrl: () => new URL(fixture.document.location.href),
    wallNow: () => 1_000,
    performanceNow: () => 0,
    IntersectionObserver: intersection.IntersectionObserver,
    createAdapter({ onCandidateBound, onCandidateUnbound }) {
      return {
        canHandle(url) {
          return url.hostname === "example.test";
        },
        getContext() {
          return context;
        },
        extractCandidates() {
          return [candidate];
        },
        observeChanges() {
          onCandidateBound(binding);
          return () => onCandidateUnbound(binding);
        }
      };
    }
  });

  await runtime.start();
  await runtime.whenIdle();

  const stored = await backend.repository.getCandidateTagProfile(
    candidate.sessionId,
    candidate.id
  );
  assert.notEqual(stored, null);
  assert.deepEqual(stored.nativeTags, []);
  assert.deepEqual(stored.normalizedTags, ["result", "robotics"]);
  assert.notEqual(
    await backend.repository.getContextTagProfile(candidate.sessionId),
    null
  );

  const finalized = await runtime.finalizeCurrentSession("fallback integration");
  assert.equal(finalized.alreadyFinalized, false);
  const selected = await backend.repository.getSessionSelectedTagProfile(
    candidate.sessionId
  );
  assert.deepEqual(selected, {
    sessionId: candidate.sessionId,
    selectedCandidateCount: 0,
    tags: []
  });

  runtime.cleanup();
});

test("Site Runtime discovery is unaffected when the Adapter has no extractCandidateTags()", async () => {
  const fixture = createBilibiliDocumentFixture({
    url: "https://example.test/search?q=robotics",
    candidates: [
      {
        title: "Generic result",
        href: "https://example.test/result/1"
      }
    ]
  });
  const candidate = {
    id: "test:candidate-1",
    url: "https://example.test/result/1",
    title: "Generic result",
    source: "test-search",
    rank: 1,
    sessionId: "test-session-no-tags"
  };
  const context = {
    query: "robotics",
    source: "test-search",
    timestamp: 100,
    keywords: ["robotics"]
  };
  const binding = { candidate, element: fixture.cards[0] };
  const backend = createBackend();
  const intersection = createIntersectionObserverHarness();
  const pageLifecycle = new EventTargetHarness();

  const runtime = createSiteRuntime({
    document: fixture.document,
    pageLifecycle,
    siteLabel: "Test Site",
    sendMessage(message) {
      return backend.sendMessage(message);
    },
    readUrl: () => new URL(fixture.document.location.href),
    wallNow: () => 1_000,
    IntersectionObserver: intersection.IntersectionObserver,
    createAdapter({ onCandidateBound, onCandidateUnbound }) {
      return {
        canHandle(url) {
          return url.hostname === "example.test";
        },
        getContext() {
          return context;
        },
        extractCandidates() {
          return [candidate];
        },
        observeChanges() {
          onCandidateBound(binding);
          return () => onCandidateUnbound(binding);
        }
      };
    }
  });

  await runtime.start();
  await runtime.whenIdle();

  assert.equal(runtime.lifecycle, "collecting");
  assert.equal(
    backend.messages.some(
      (message) => message.type === MESSAGE_TYPES.CANDIDATE_TAGS_DISCOVERED
    ),
    false
  );

  runtime.cleanup();
});

test("Site Runtime drops native tags for Candidates outside the accepted batch", async () => {
  const fixture = createBilibiliDocumentFixture({
    url: "https://example.test/search?q=robotics",
    candidates: [
      {
        title: "Generic result",
        href: "https://example.test/result/1"
      }
    ]
  });
  const candidate = {
    id: "test:candidate-1",
    url: "https://example.test/result/1",
    title: "Generic result",
    source: "test-search",
    rank: 1,
    sessionId: "test-session-foreign-tags"
  };
  const context = {
    query: "robotics",
    source: "test-search",
    timestamp: 100,
    keywords: ["robotics"]
  };
  const binding = { candidate, element: fixture.cards[0] };
  const backend = createBackend();
  const intersection = createIntersectionObserverHarness();
  const pageLifecycle = new EventTargetHarness();

  const runtime = createSiteRuntime({
    document: fixture.document,
    pageLifecycle,
    siteLabel: "Test Site",
    sendMessage(message) {
      return backend.sendMessage(message);
    },
    readUrl: () => new URL(fixture.document.location.href),
    wallNow: () => 1_000,
    IntersectionObserver: intersection.IntersectionObserver,
    createAdapter({ onCandidateBound, onCandidateUnbound }) {
      return {
        canHandle(url) {
          return url.hostname === "example.test";
        },
        getContext() {
          return context;
        },
        extractCandidates() {
          return [candidate];
        },
        extractCandidateTags() {
          return [
            { candidateId: "test:candidate-1", nativeTags: ["#AI"] },
            { candidateId: "test:candidate-not-discovered", nativeTags: ["#x"] }
          ];
        },
        observeChanges() {
          onCandidateBound(binding);
          return () => onCandidateUnbound(binding);
        }
      };
    }
  });

  await runtime.start();
  await runtime.whenIdle();

  const tagMessage = backend.messages.find(
    (message) => message.type === MESSAGE_TYPES.CANDIDATE_TAGS_DISCOVERED
  );
  assert.notEqual(tagMessage, undefined);
  assert.deepEqual(
    tagMessage.payload.tags.map((entry) => entry.candidateId),
    ["test:candidate-1"]
  );

  runtime.cleanup();
});

test("Site Runtime source contains no Bilibili Adapter, URL, or selector", () => {
  const source = readFileSync("content/siteRuntime.js", "utf8");

  assert.doesNotMatch(
    source,
    /bilibiliSearchAdapter|search\.bilibili\.com|bili-video-card/iu
  );
  assert.match(source, /options\.createAdapter/u);
});
