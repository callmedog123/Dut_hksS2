import assert from "node:assert/strict";
import test from "node:test";

import { createMessageRouter } from "../../background/messageRouter.js";
import { createSessionFinalizeUseCase } from "../../background/sessionFinalize.js";
import { createSessionManager } from "../../background/sessionManager.js";
import { createZhihuRuntime } from "../../content/zhihuRuntime.js";
import {
  MESSAGE_TYPES,
  RESPONSE_ERROR_CODES,
  createErrorResponseMessage,
  createSuccessResponseMessage
} from "../../shared/messages.js";
import { createRepository } from "../../storage/repository.js";
import {
  createMutationObserverHarness,
  createZhihuDocumentFixture
} from "../adapters/fixtures/zhihuDom.js";
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
  dispatch(type) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ type, target: this });
    }
  }
}

function createBackend(storageAdapter) {
  const repository = createRepository(storageAdapter);
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
      const settings = await repository.getSettings();
      if (!settings.enabled) {
        return createErrorResponseMessage(message.requestId, {
          code: RESPONSE_ERROR_CODES.COLLECTION_PAUSED,
          message: "Collection is paused in Settings.",
          retryable: false
        });
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

function createHarness({ url, candidates = [] } = {}) {
  const fixture = createZhihuDocumentFixture({ url, candidates });
  const mutation = createMutationObserverHarness();
  const intersection = createIntersectionObserverHarness();
  const pageLifecycle = new EventTargetHarness();
  const backend = createBackend(createTransactionalMemoryStorageAdapter());
  let wallTime = 1_000;
  let sessionSequence = 0;
  const runtime = createZhihuRuntime({
    document: fixture.document,
    pageLifecycle,
    sendMessage(message) {
      return backend.sendMessage(message);
    },
    readUrl: () => new URL(fixture.document.location.href),
    wallNow: () => (wallTime += 1),
    performanceNow: () => 0,
    MutationObserver: mutation.MutationObserver,
    IntersectionObserver: intersection.IntersectionObserver,
    sessionIdFactory: () => `zhihu-runtime-${++sessionSequence}`
  });
  return { backend, fixture, mutation, pageLifecycle, runtime };
}

test("Zhihu Runtime discovers all three supported types through shared orchestration", async () => {
  const harness = createHarness({
    candidates: [
      { type: "question", title: "Question", href: "/question/1" },
      { type: "answer", title: "Answer", href: "/question/1/answer/2" },
      { type: "article", title: "Article", href: "//zhuanlan.zhihu.com/p/3" }
    ]
  });

  await harness.runtime.start();
  await harness.runtime.whenIdle();
  const discovery = harness.backend.messages.find(
    (message) => message.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED
  );
  assert.deepEqual(
    discovery.payload.candidates.map((candidate) => [
      candidate.id,
      candidate.contentType,
      candidate.layoutType
    ]),
    [
      ["zhihu:question:1", "QUESTION", "TEXT_LIST"],
      ["zhihu:answer:2", "ANSWER", "TEXT_LIST"],
      ["zhihu:article:3", "ARTICLE", "TEXT_LIST"]
    ]
  );
  assert.equal(
    harness.backend.messages.some(
      (message) => message.type === MESSAGE_TYPES.CANDIDATE_TAGS_DISCOVERED
    ),
    false
  );
  harness.runtime.cleanup();
});

test("Zhihu Runtime handles dynamic results and finalizes before a query switch", async () => {
  const harness = createHarness({
    candidates: [{ type: "question", title: "First", href: "/question/1" }]
  });
  await harness.runtime.start();
  await harness.runtime.whenIdle();

  harness.fixture.addCandidate({
    type: "article",
    title: "Dynamic",
    href: "//zhuanlan.zhihu.com/p/2"
  });
  harness.mutation.notifyAll();
  await harness.runtime.whenIdle();
  assert.equal(
    harness.backend.messages.filter(
      (message) => message.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED
    ).length,
    2
  );

  harness.fixture.navigate(
    "https://www.zhihu.com/search?type=content&q=second",
    [{ type: "answer", title: "Second", href: "/question/3/answer/4" }]
  );
  harness.mutation.notifyAll();
  await harness.runtime.whenIdle();
  const lifecycleMessages = harness.backend.messages
    .filter((message) =>
      [MESSAGE_TYPES.SESSION_FINALIZE, MESSAGE_TYPES.CANDIDATES_DISCOVERED].includes(
        message.type
      )
    )
    .map((message) => [message.type, message.payload.sessionId]);
  assert.deepEqual(lifecycleMessages.slice(-2), [
    [MESSAGE_TYPES.SESSION_FINALIZE, "zhihu-runtime-1"],
    [MESSAGE_TYPES.CANDIDATES_DISCOVERED, "zhihu-runtime-2"]
  ]);
  harness.runtime.cleanup();
});

test("Zhihu Runtime remains inactive on unsupported search tabs", async () => {
  const harness = createHarness({
    url: "https://www.zhihu.com/search?type=people&q=robot",
    candidates: [{ type: "question", title: "Must not collect", href: "/question/1" }]
  });
  await harness.runtime.start();
  await harness.runtime.whenIdle();
  assert.equal(harness.runtime.lifecycle, "inactive");
  assert.equal(harness.backend.messages.length, 0);
  harness.runtime.cleanup();
});
