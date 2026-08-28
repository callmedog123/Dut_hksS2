import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createMessageRouter } from "../../background/messageRouter.js";
import { createSessionFinalizeUseCase } from "../../background/sessionFinalize.js";
import { createSessionManager } from "../../background/sessionManager.js";
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

function createBackend() {
  const repository = createRepository(
    createTransactionalMemoryStorageAdapter()
  );
  const sessionManager = createSessionManager(repository);
  const router = createMessageRouter(repository, {
    sessionFinalizeUseCase: createSessionFinalizeUseCase(sessionManager)
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

test("Site Runtime source contains no Bilibili Adapter, URL, or selector", () => {
  const source = readFileSync("content/siteRuntime.js", "utf8");

  assert.doesNotMatch(
    source,
    /bilibiliSearchAdapter|search\.bilibili\.com|bili-video-card/iu
  );
  assert.match(source, /options\.createAdapter/u);
});
