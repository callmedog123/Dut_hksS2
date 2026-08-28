import assert from "node:assert/strict";
import test from "node:test";

import { createMessageRouter } from "../../background/messageRouter.js";
import { createSessionFinalizeUseCase } from "../../background/sessionFinalize.js";
import { createSessionManager } from "../../background/sessionManager.js";
import { createBilibiliRuntime } from "../../content/bilibiliRuntime.js";
import {
  MESSAGE_TYPES,
  RESPONSE_ERROR_CODES,
  createErrorResponseMessage,
  createSuccessResponseMessage
} from "../../shared/messages.js";
import { DEFAULT_SETTINGS_V1 } from "../../shared/types.js";
import { createRepository } from "../../storage/repository.js";
import {
  createBilibiliDocumentFixture,
  createMutationObserverHarness
} from "../adapters/fixtures/bilibiliDom.js";
import { createIntersectionObserverHarness } from "../adapters/fixtures/demoDom.js";
import { createTransactionalMemoryStorageAdapter } from "../storage/fixtures/memoryStorageAdapter.js";

const FIRST_QUERY_URL =
  "https://search.bilibili.com/all?keyword=robot%20navigation";

function createCandidate(index) {
  return {
    title: `Bilibili result ${index}`,
    href: `https://www.bilibili.com/video/BV1Runtime00${index}/`
  };
}

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

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

function createTimeoutHarness() {
  let now = 0;
  let sequence = 0;
  const tasks = new Map();
  return {
    setTimeout(callback, delay) {
      const id = ++sequence;
      tasks.set(id, { callback, dueAt: now + delay });
      return id;
    },
    clearTimeout(id) {
      tasks.delete(id);
    },
    advanceBy(elapsedMs) {
      now += elapsedMs;
      const due = [...tasks.entries()]
        .filter(([, task]) => task.dueAt <= now)
        .sort((left, right) => left[1].dueAt - right[1].dueAt);
      for (const [id, task] of due) {
        tasks.delete(id);
        task.callback();
      }
    },
    get pendingCount() {
      return tasks.size;
    }
  };
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

function createRuntimeHarness({
  storageAdapter = createTransactionalMemoryStorageAdapter(),
  candidates = [createCandidate(1), createCandidate(2)],
  statuses = [],
  timers = null
} = {}) {
  const fixture = createBilibiliDocumentFixture({
    url: FIRST_QUERY_URL,
    candidates
  });
  const mutation = createMutationObserverHarness();
  const intersection = createIntersectionObserverHarness();
  const pageLifecycle = new EventTargetHarness();
  let backend = createBackend(storageAdapter);
  let wallTime = 1_000;
  let performanceTime = 0;
  let sessionSequence = 0;
  const runtime = createBilibiliRuntime({
    document: fixture.document,
    pageLifecycle,
    sendMessage(message) {
      return backend.sendMessage(message);
    },
    readUrl: () => new URL(fixture.document.location.href),
    wallNow: () => (wallTime += 1),
    performanceNow: () => performanceTime,
    MutationObserver: mutation.MutationObserver,
    IntersectionObserver: intersection.IntersectionObserver,
    ...(timers === null
      ? {}
      : {
          setTimeout: timers.setTimeout,
          clearTimeout: timers.clearTimeout
        }),
    sessionIdFactory: () => `bilibili-session-${++sessionSequence}`,
    onStatus(status) {
      statuses.push(status);
    }
  });

  return {
    backend: () => backend,
    fixture,
    intersection,
    mutation,
    pageLifecycle,
    runtime,
    statuses,
    setBackend(nextBackend) {
      backend = nextBackend;
    },
    setPerformanceTime(value) {
      performanceTime = value;
    },
    storageAdapter
  };
}

test("collects initial/dynamic Candidates, absolute signals, and every supported click without blocking navigation", async () => {
  const harness = createRuntimeHarness({
    candidates: [
      createCandidate(1),
      createCandidate(2),
      createCandidate(3),
      createCandidate(4)
    ]
  });

  await harness.runtime.start();
  await harness.runtime.whenIdle();
  assert.equal(harness.runtime.lifecycle, "collecting");
  assert.equal(harness.runtime.activeSessionId, "bilibili-session-1");

  const clickScenarios = [
    ["click", 0, {}],
    ["auxclick", 1, { button: 1 }],
    ["click", 2, { ctrlKey: true }],
    ["click", 3, { metaKey: true }]
  ];
  for (const [type, index, init] of clickScenarios) {
    const event = harness.fixture.document.dispatch(
      type,
      harness.fixture.clickTarget(index),
      init
    );
    assert.equal(event.defaultPrevented, false);
    assert.equal(event.preventDefaultCalls, 0);
  }
  await harness.runtime.whenIdle();
  assert.equal(
    harness.backend().messages.filter(
      (message) => message.type === MESSAGE_TYPES.CANDIDATE_CHOSEN
    ).length,
    4
  );

  const dynamicCard = harness.fixture.addCandidate(createCandidate(5));
  harness.mutation.notifyAll();
  await harness.runtime.whenIdle();
  const session = await harness.backend().repository.getSession(
    "bilibili-session-1"
  );
  assert.equal(session.candidates.length, 5);

  const discoveryCount = harness.backend().messages.filter(
    (message) => message.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED
  ).length;
  harness.fixture.addUnrelatedNode();
  harness.mutation.notifyAll();
  await harness.runtime.whenIdle();
  assert.equal(
    harness.backend().messages.filter(
      (message) => message.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED
    ).length,
    discoveryCount
  );

  harness.setPerformanceTime(100);
  dynamicCard.dispatchEvent({ type: "mouseenter" });
  harness.setPerformanceTime(2_100);
  dynamicCard.dispatchEvent({ type: "mouseleave" });
  harness.setPerformanceTime(3_000);
  harness.intersection.setVisible(dynamicCard, false);
  harness.intersection.setVisible(dynamicCard, true);
  harness.intersection.setVisible(dynamicCard, false);
  harness.intersection.setVisible(dynamicCard, true);
  await harness.runtime.whenIdle();

  const dynamicSignals = harness.backend().messages
    .filter(
      (message) =>
        message.type === MESSAGE_TYPES.SIGNALS_UPDATED &&
        message.payload.signals.candidateId === "BV1Runtime005"
    )
    .at(-1).payload.signals;
  assert.equal(dynamicSignals.visibleMs, 3_000);
  assert.equal(dynamicSignals.hoverMs, 2_000);
  assert.equal(dynamicSignals.hoverCount, 1);
  assert.equal(dynamicSignals.returnCount, 2);
  assert.equal(dynamicSignals.clicked, false);

  harness.runtime.cleanup();
  await harness.runtime.whenIdle();
  const messagesAfterCleanup = harness.backend().messages.length;
  harness.fixture.addCandidate(createCandidate(6));
  harness.mutation.notifyAll();
  assert.equal(harness.backend().messages.length, messagesAfterCleanup);
  assert.equal(harness.fixture.document.listenerCount("click"), 0);
  assert.equal(harness.fixture.document.listenerCount("auxclick"), 0);
  assert.equal(harness.fixture.document.listenerCount("visibilitychange"), 0);
  assert.equal(harness.mutation.instances[0].disconnectCount, 1);
});

test("checkpoints changed absolute signals by the configured maximum delay only", async () => {
  const timers = createTimeoutHarness();
  const harness = createRuntimeHarness({
    candidates: [createCandidate(1)],
    timers
  });
  await harness.runtime.start();
  await harness.runtime.whenIdle();

  harness.setPerformanceTime(1_999);
  timers.advanceBy(1_999);
  await harness.runtime.whenIdle();
  assert.equal(
    harness.backend().messages.filter(
      (message) => message.type === MESSAGE_TYPES.SIGNALS_UPDATED
    ).length,
    0
  );

  harness.setPerformanceTime(2_000);
  timers.advanceBy(1);
  await harness.runtime.whenIdle();
  const firstCheckpointCount = harness.backend().messages.filter(
    (message) => message.type === MESSAGE_TYPES.SIGNALS_UPDATED
  ).length;
  assert.equal(firstCheckpointCount, 1);
  assert.equal(
    harness.backend().messages.find(
      (message) => message.type === MESSAGE_TYPES.SIGNALS_UPDATED
    ).payload.signals.visibleMs,
    2_000
  );

  timers.advanceBy(2_000);
  await harness.runtime.whenIdle();
  assert.equal(
    harness.backend().messages.filter(
      (message) => message.type === MESSAGE_TYPES.SIGNALS_UPDATED
    ).length,
    firstCheckpointCount
  );

  harness.setPerformanceTime(2_500);
  harness.runtime.cleanup();
  await harness.runtime.whenIdle();
  assert.equal(timers.pendingCount, 0);
  assert.equal(
    harness.backend().messages.filter(
      (message) => message.type === MESSAGE_TYPES.SIGNALS_UPDATED
    ).at(-1).payload.signals.visibleMs,
    2_500
  );
});

test("retries a failed checkpoint and keeps the newest absolute snapshot", async () => {
  const timers = createTimeoutHarness();
  const harness = createRuntimeHarness({
    candidates: [createCandidate(1)],
    timers
  });
  await harness.runtime.start();
  await harness.runtime.whenIdle();

  harness.storageAdapter.failNextCommit(
    new Error("simulated checkpoint write failure")
  );
  harness.setPerformanceTime(2_000);
  timers.advanceBy(2_000);
  await harness.runtime.whenIdle();
  assert.equal(
    (await harness.backend().repository.getSession("bilibili-session-1"))
      .candidates[0].signals.visibleMs,
    0
  );

  harness.setPerformanceTime(4_000);
  timers.advanceBy(2_000);
  await harness.runtime.whenIdle();
  assert.equal(
    (await harness.backend().repository.getSession("bilibili-session-1"))
      .candidates[0].signals.visibleMs,
    4_000
  );
  harness.runtime.cleanup();
  await harness.runtime.whenIdle();
});

test("finalizes the old Session before binding a new SPA query and supports repeated video IDs", async () => {
  const harness = createRuntimeHarness();
  await harness.runtime.start();
  await harness.runtime.whenIdle();

  const highCard = harness.fixture.cards[1];
  harness.setPerformanceTime(0);
  highCard.dispatchEvent({ type: "mouseenter" });
  harness.setPerformanceTime(3_000);
  highCard.dispatchEvent({ type: "mouseleave" });
  harness.setPerformanceTime(10_000);
  harness.intersection.setVisible(highCard, false);
  harness.intersection.setVisible(highCard, true);
  harness.intersection.setVisible(highCard, false);
  harness.intersection.setVisible(highCard, true);

  harness.fixture.navigate(
    "https://search.bilibili.com/all?keyword=spatial%20reasoning",
    [
      {
        title: "Repeated video in a new query",
        href: "https://www.bilibili.com/video/BV1Runtime002/"
      }
    ]
  );
  harness.mutation.notifyAll();
  await harness.runtime.whenIdle();

  const transitionMessages = harness.backend().messages.filter(
    (message) =>
      message.type === MESSAGE_TYPES.SESSION_FINALIZE ||
      message.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED
  );
  const oldFinalizeIndex = transitionMessages.findIndex(
    (message) =>
      message.type === MESSAGE_TYPES.SESSION_FINALIZE &&
      message.payload.sessionId === "bilibili-session-1"
  );
  const newDiscoveryIndex = transitionMessages.findIndex(
    (message) =>
      message.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED &&
      message.payload.sessionId === "bilibili-session-2"
  );
  assert.ok(oldFinalizeIndex >= 0);
  assert.ok(newDiscoveryIndex > oldFinalizeIndex);
  assert.notEqual(
    await harness.backend().repository.getSessionFinalization(
      "bilibili-session-1"
    ),
    null
  );
  assert.equal(harness.runtime.activeSessionId, "bilibili-session-2");
  assert.equal(harness.runtime.lifecycle, "collecting");

  const missedPaths = await harness.backend().repository.listMissedPaths();
  assert.deepEqual(
    missedPaths.map((missedPath) => missedPath.candidate.id),
    ["BV1Runtime002"]
  );
  harness.runtime.cleanup();
});

test("honors persisted pause, resumes on a later DOM change, and survives Worker restart", async () => {
  const storageAdapter = createTransactionalMemoryStorageAdapter();
  const settingsRepository = createRepository(storageAdapter);
  await settingsRepository.saveSettings({
    ...DEFAULT_SETTINGS_V1,
    enabled: false
  });
  const harness = createRuntimeHarness({ storageAdapter });

  await harness.runtime.start();
  await harness.runtime.whenIdle();
  assert.equal(harness.runtime.lifecycle, "paused");
  assert.equal(
    await harness.backend().repository.getSession("bilibili-session-1"),
    null
  );

  await settingsRepository.saveSettings({
    ...DEFAULT_SETTINGS_V1,
    enabled: true
  });
  harness.fixture.addCandidate(createCandidate(3));
  harness.mutation.notifyAll();
  await harness.runtime.whenIdle();
  assert.equal(harness.runtime.lifecycle, "collecting");
  assert.equal(
    (await harness.backend().repository.getSession("bilibili-session-1"))
      .candidates.length,
    3
  );

  const restartedBackend = createBackend(storageAdapter);
  harness.setBackend(restartedBackend);
  harness.fixture.addCandidate(createCandidate(4));
  harness.mutation.notifyAll();
  await harness.runtime.whenIdle();
  assert.equal(
    restartedBackend.messages.some(
      (message) => message.type === MESSAGE_TYPES.CANDIDATES_DISCOVERED
    ),
    true
  );

  harness.pageLifecycle.dispatch("pagehide");
  await harness.runtime.whenIdle();
  assert.notEqual(
    await restartedBackend.repository.getSessionFinalization(
      "bilibili-session-1"
    ),
    null
  );
  assert.equal((await restartedBackend.repository.getSettings()).enabled, true);
  harness.runtime.cleanup();
});

test("settles absolute signals when hidden and safely degrades selector failure", async () => {
  const harness = createRuntimeHarness();
  await harness.runtime.start();
  await harness.runtime.whenIdle();

  harness.setPerformanceTime(4_000);
  harness.fixture.document.hidden = true;
  harness.fixture.document.dispatchEvent({ type: "visibilitychange" });
  await harness.runtime.whenIdle();
  assert.equal(
    harness.backend().messages.some(
      (message) =>
        message.type === MESSAGE_TYPES.SIGNALS_UPDATED &&
        message.payload.signals.visibleMs === 4_000
    ),
    true
  );
  harness.runtime.cleanup();

  const brokenHarness = createRuntimeHarness();
  brokenHarness.fixture.document.querySelector = () => {
    throw new Error("Bilibili selector changed");
  };
  await brokenHarness.runtime.start();
  await brokenHarness.runtime.whenIdle();
  assert.equal(brokenHarness.runtime.lifecycle, "waiting");
  assert.equal(brokenHarness.backend().messages.length, 0);
  brokenHarness.runtime.cleanup();
});
