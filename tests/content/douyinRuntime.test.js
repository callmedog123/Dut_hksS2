// @ts-check

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMessageRouter } from "../../background/messageRouter.js";
import { createSessionFinalizeUseCase } from "../../background/sessionFinalize.js";
import { createSessionManager } from "../../background/sessionManager.js";
import { createTagEnrichmentCoordinator } from "../../background/tagEnrichment.js";
import { createDouyinRuntime, DouyinRuntimeError } from "../../content/douyinRuntime.js";
import {
  MESSAGE_TYPES,
  createSignalsUpdatedMessage
} from "../../shared/messages.js";
import { createRepository } from "../../storage/repository.js";
import {
  HASHTAG_NUMERIC_ID,
  VIDEO_NUMERIC_ID,
  createDouyinSearchDom,
  createMutationObserverHarness,
  createVideoCard
} from "../adapters/fixtures/douyinDom.js";
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

function createBackend() {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const sessionManager = createSessionManager(repository);
  const tagEnrichmentCoordinator = createTagEnrichmentCoordinator(
    repository,
    null
  );
  const router = createMessageRouter(repository, {
    sessionFinalizeUseCase: createSessionFinalizeUseCase(sessionManager),
    tagEnrichmentCoordinator
  });
  const messages = [];
  return {
    messages,
    repository,
    sendMessage(message) {
      messages.push(message);
      return router.route(message);
    }
  };
}

function createIntegratedRuntime({ title, candidateId, sessionId }) {
  const document = createDouyinSearchDom({
    cards: [createVideoCard(candidateId, title)]
  });
  const mutations = createMutationObserverHarness();
  const intersections = createIntersectionObserverHarness();
  const backend = createBackend();
  const runtime = createDouyinRuntime({
    document,
    pageLifecycle: new EventTargetHarness(),
    MutationObserver: mutations.MutationObserver,
    IntersectionObserver: intersections.IntersectionObserver,
    sessionIdFactory: () => sessionId,
    readUrl: () => new URL(document.location.href),
    wallNow: () => 1_000,
    performanceNow: () => 0,
    sendMessage(message) {
      return backend.sendMessage(message);
    }
  });
  return { backend, document, runtime };
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

  it("persists visible Douyin hashtags through Runtime, Router, and Repository", async () => {
    const sessionId = "douyin-native-tag-session";
    const candidateId = `douyin:video:${HASHTAG_NUMERIC_ID}`;
    const { backend, runtime } = createIntegratedRuntime({
      title: "08:51 Test #美食 #羊肉 #地方特色美食",
      candidateId: HASHTAG_NUMERIC_ID,
      sessionId
    });

    await runtime.start();
    await runtime.whenIdle();

    assert.equal(
      backend.messages.some(
        (message) => message.type === MESSAGE_TYPES.CANDIDATE_TAGS_DISCOVERED
      ),
      true
    );
    assert.deepEqual(
      await backend.repository.getCandidateTagProfile(sessionId, candidateId),
      {
        candidateId,
        sessionId,
        nativeTags: ["地方特色美食", "羊肉", "美食"],
        normalizedTags: [
          "08",
          "51",
          "test",
          "地方特色美食",
          "羊肉",
          "美食"
        ]
      }
    );

    await backend.sendMessage(
      createSignalsUpdatedMessage(
        {
          candidateId,
          sessionId,
          visibleMs: 10_000,
          hoverMs: 4_000,
          hoverCount: 2,
          returnCount: 1,
          clicked: false
        },
        2_000
      )
    );
    assert.deepEqual(
      (await backend.repository.getCandidateTagProfile(sessionId, candidateId))
        ?.nativeTags,
      ["地方特色美食", "羊肉", "美食"]
    );

    runtime.cleanup();
  });

  it("uses the shared local fallback when a Douyin card has no hashtag", async () => {
    const sessionId = "douyin-local-fallback-session";
    const candidateId = `douyin:video:${VIDEO_NUMERIC_ID}`;
    const { backend, runtime } = createIntegratedRuntime({
      title: "02:08 羊肉烹饪教程",
      candidateId: VIDEO_NUMERIC_ID,
      sessionId
    });

    await runtime.start();
    await runtime.whenIdle();

    assert.equal(
      backend.messages.some(
        (message) => message.type === MESSAGE_TYPES.CANDIDATE_TAGS_DISCOVERED
      ),
      false
    );
    const profile = await backend.repository.getCandidateTagProfile(
      sessionId,
      candidateId
    );
    assert.notEqual(profile, null);
    assert.deepEqual(profile.nativeTags, []);
    assert.ok(profile.normalizedTags.includes("羊肉烹饪教程"));

    runtime.cleanup();
  });
});
